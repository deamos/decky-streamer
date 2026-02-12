import os
import sys
import traceback
import subprocess
import signal
import time
from pathlib import Path
from settings import SettingsManager
import decky_plugin
import logging
from logging.handlers import RotatingFileHandler

# Get environment variable
settingsDir = os.environ["DECKY_PLUGIN_SETTINGS_DIR"]

import asyncio

DEPSPATH = Path(decky_plugin.DECKY_PLUGIN_DIR) / "bin"
if not DEPSPATH.exists():
    DEPSPATH = Path(decky_plugin.DECKY_PLUGIN_DIR) / "backend/out"
GSTPLUGINSPATH = DEPSPATH / "gstreamer-1.0"

# Log file paths
LOG_DIR = Path(decky_plugin.DECKY_PLUGIN_LOG_DIR)
std_out_file_path = LOG_DIR / "decky-streamer-std-out.log"
std_err_file_path = LOG_DIR / "decky-streamer-std-err.log"

# Max log file sizes (in bytes)
MAX_LOG_SIZE = 1 * 1024 * 1024  # 1 MB for main log
MAX_STD_LOG_SIZE = 512 * 1024   # 512 KB for stdout/stderr

# Truncate stdout/stderr files if they exist and are too large
def truncate_if_large(file_path, max_size):
    try:
        if file_path.exists() and file_path.stat().st_size > max_size:
            # Keep the last portion of the file
            with open(file_path, 'rb') as f:
                f.seek(-max_size // 2, 2)  # Seek to last half of max size
                content = f.read()
            with open(file_path, 'wb') as f:
                f.write(b"... [truncated] ...\n")
                f.write(content)
    except Exception:
        pass

truncate_if_large(std_out_file_path, MAX_STD_LOG_SIZE)
truncate_if_large(std_err_file_path, MAX_STD_LOG_SIZE)

std_out_file = open(std_out_file_path, "a")  # Append mode
std_err_file = open(std_err_file_path, "a")  # Append mode

# Setup logger with size-based rotation
logger = decky_plugin.logger
log_file = LOG_DIR / "decky-streamer.log"
log_file_handler = RotatingFileHandler(
    log_file, 
    maxBytes=MAX_LOG_SIZE, 
    backupCount=2
)
log_file_handler.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s"))
logger.handlers.clear()
logger.addHandler(log_file_handler)
logger.setLevel(logging.INFO)

try:
    sys.path = [str(DEPSPATH / "psutil")] + sys.path
    import psutil
    logger.info("Successfully loaded psutil")
except Exception:
    logger.info(traceback.format_exc())


def find_gst_processes():
    pids = []
    for child in psutil.process_iter():
        try:
            if "Decky-Streamer" in " ".join(child.cmdline()):
                pids.append(child.pid)
        except psutil.NoSuchProcess:
            pass
    return pids


def in_gamemode():
    for child in psutil.process_iter():
        try:
            if "gamescope-session" in " ".join(child.cmdline()):
                return True
        except psutil.NoSuchProcess:
            pass
    return False


def get_cmd_output(cmd, log=True):
    if log:
        logger.debug(f"Command: {cmd}")
    # Clear LD_LIBRARY_PATH to avoid conflicts with system libraries
    env = os.environ.copy()
    env.pop('LD_LIBRARY_PATH', None)
    env.pop('LD_PRELOAD', None)
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, env=env)
    return (result.stdout + result.stderr).strip()


def unload_pa_modules(search_string):
    module_list = get_cmd_output(f"pactl list short modules | grep '{search_string}' | awk '{{print $1}}'").split("\n")
    for module_id in module_list:
        get_cmd_output(f"pactl unload-module {module_id}")


# Streaming platform presets
PLATFORM_URLS = {
    "twitch": "rtmp://ingest.global-contribute.live-video.net/app",
    "youtube": "rtmp://a.rtmp.youtube.com/live2",
    "kick": "rtmp://fa723fc1b171.global-contribute.live-video.net/app",
    "facebook": "rtmps://live-api-s.facebook.com:443/rtmp",
    "custom": ""
}

# Resolution presets (width, height)
RESOLUTION_PRESETS = {
    "720p": {"width": 1280, "height": 720},
    "800p": {"width": 1280, "height": 800},  # Steam Deck native
    "1080p": {"width": 1920, "height": 1080},
    "native": {"width": 0, "height": 0}  # 0 means no scaling
}


def build_rtmp_url(platform, custom_url, stream_key):
    """Build the full RTMP URL with stream key"""
    if platform == "custom":
        url = custom_url.strip() if custom_url else ""
    else:
        url = PLATFORM_URLS.get(platform, "")
    
    url = url.rstrip('/')
    stream_key = stream_key.strip() if stream_key else ""
    if stream_key:
        return f"{url}/{stream_key}"
    return url


RTMP_MISSING_MESSAGE = (
    "RTMP plugin not available (missing librtmp). "
    "On SteamOS: open Konsole and run: sudo steamos-readonly disable && sudo pacman -S rtmpdump && sudo steamos-readonly enable"
)


def _streaming_env():
    """Build env for GStreamer subprocess: use plugin's bin for libs (e.g. librtmp)."""
    env = os.environ.copy()
    env.pop("LD_PRELOAD", None)
    # Prepend plugin bin so bundled librtmp (and other deps) are found when loading libgstrtmp
    env["LD_LIBRARY_PATH"] = str(DEPSPATH)
    env["GST_PLUGIN_PATH"] = str(GSTPLUGINSPATH)
    return env


def _check_rtmpsink_available():
    """Return True if GStreamer rtmpsink element is available (librtmp loaded)."""
    env = _streaming_env()
    result = subprocess.run(
        ["gst-inspect-1.0", "rtmpsink"],
        env=env,
        capture_output=True,
        text=True,
        timeout=5,
    )
    return result.returncode == 0


def get_video_scale_caps(resolution):
    """Get the video scaling caps filter based on resolution preset"""
    preset = RESOLUTION_PRESETS.get(resolution, RESOLUTION_PRESETS["720p"])
    if preset["width"] == 0:
        return ""
    return f"video/x-raw,width={preset['width']},height={preset['height']}"


def detect_display_resolution():
    """Detect the current display resolution using xrandr"""
    # Try displays in order: :0 (works when docked), :1 (game display in handheld)
    displays_to_try = [":0", ":1"]
    
    for display in displays_to_try:
        try:
            env = os.environ.copy()
            env.pop('LD_LIBRARY_PATH', None)
            env.pop('LD_PRELOAD', None)
            env['DISPLAY'] = display
            
            # Try xrandr first
            result = subprocess.run(
                "xrandr | grep '*' | awk '{print $1}'",
                shell=True, capture_output=True, text=True, env=env
            )
            if result.returncode == 0 and result.stdout.strip():
                # Parse resolution like "1280x800"
                res = result.stdout.strip().split('\n')[0]
                if 'x' in res:
                    width, height = res.split('x')
                    return {"width": int(width), "height": int(height), "display": display}
            
            # Fallback to xdpyinfo
            result = subprocess.run(
                "xdpyinfo | grep dimensions | awk '{print $2}'",
                shell=True, capture_output=True, text=True, env=env
            )
            if result.returncode == 0 and result.stdout.strip():
                res = result.stdout.strip()
                if 'x' in res:
                    width, height = res.split('x')
                    return {"width": int(width), "height": int(height), "display": display}
        except Exception as e:
            logger.debug(f"Could not detect display resolution on {display}: {e}")
    
    # Default to Steam Deck native
    return {"width": 1280, "height": 800, "display": "default"}


class Plugin:
    _streaming_process = None
    _platform: str = "twitch"  # twitch, youtube, kick, facebook, custom

    @staticmethod
    def _friendly_error_from_stderr(stderr_content):
        """Parse GStreamer stderr and return a short user-facing message for known issues."""
        if not stderr_content:
            return ""
        s = stderr_content.lower()
        if ("rtmpsink" in s and ("no element" in s or "erroneous pipeline" in s)) or "librtmp" in s or "libgstrtmp" in s:
            return RTMP_MISSING_MESSAGE
        return ""
    _rtmpUrl: str = ""
    _customRtmpUrl: str = ""
    _streamKey: str = ""
    _videoBitrate: int = 4500  # kbps - good for 720p60
    _audioBitrate: int = 160  # kbps
    _resolution: str = "720p"  # 720p, 1080p
    _framerate: int = 60
    _keyframeInterval: int = 0  # 0 = use encoder default (typically 30), otherwise specific value
    _bframes: int = 0  # 0 = use encoder default, otherwise specific value (0-3)
    _micEnabled: bool = False
    _micGain: float = 13.0
    _noiseReductionPercent: int = 50
    _micSource: str = "NA"
    _deckySinkModuleName: str = "Decky-Streaming-Sink"
    _echoCancelledAudioName: str = "Echo-Cancelled-Audio"
    _echoCancelledMicName: str = "Echo-Cancelled-Mic"
    _optional_denoise_binary_path = decky_plugin.DECKY_USER_HOME + "/homebrew/data/decky-streamer/librnnoise_ladspa.so"
    _watchdog_task = None
    _wakeup_count = 1
    _settings = None
    _stream_start_time = None
    _stream_error: bool = False
    _last_error_message: str = ""
    

    async def get_wakeup_count(self):
        return self._wakeup_count

    async def set_wakeup_count(self, new_count):
        self._wakeup_count = new_count

    async def clear_rogue_gst_processes(self):
        gst_pids = find_gst_processes()
        curr_pid = self._streaming_process.pid if self._streaming_process is not None else None
        for pid in gst_pids:
            if pid != curr_pid:
                logger.info(f"Killing rogue process {pid}")
                os.kill(pid, signal.SIGKILL)

    async def watchdog(self):
        logger.info("Watchdog started")
        while True:
            try:
                in_gm = in_gamemode()
                is_streaming = await Plugin.is_streaming(self, verbose=False)
                
                # Stop streaming if we leave game mode
                if not in_gm and is_streaming:
                    logger.warn("Left gamemode but streaming was still running, stopping stream")
                    await Plugin.stop_streaming(self)
                    await Plugin.clear_rogue_gst_processes(self)
                
                # Check for process crash/exit (is_streaming already handles this, 
                # but we also want to check stderr for connection errors)
                if self._streaming_process is not None:
                    # Check stderr for connection errors without blocking
                    try:
                        import select
                        if hasattr(self._streaming_process, 'stderr') and self._streaming_process.stderr:
                            # Non-blocking read check
                            ready, _, _ = select.select([self._streaming_process.stderr], [], [], 0)
                            if ready:
                                line = self._streaming_process.stderr.readline()
                                if line:
                                    line_str = line.decode('utf-8', errors='ignore').strip()
                                    # Check for connection-related errors
                                    error_indicators = [
                                        "Connection refused",
                                        "Could not connect",
                                        "Failed to connect",
                                        "Connection timed out",
                                        "Connection reset",
                                        "Broken pipe",
                                        "Network is unreachable",
                                        "RTMP connection failed",
                                        "rtmp2sink",
                                        "ERROR",
                                    ]
                                    for indicator in error_indicators:
                                        if indicator.lower() in line_str.lower():
                                            logger.error(f"Stream connection error: {line_str}")
                                            self._stream_error = True
                                            self._last_error_message = line_str[:200]  # Truncate long messages
                                            break
                    except Exception as e:
                        logger.debug(f"Error checking stderr: {e}")
                    
            except Exception as e:
                logger.exception(f"Watchdog exception! {str(e)}")

            # Restart streaming on sleep wake up to resolve issues
            wakeup_count = int(get_cmd_output("cat /sys/power/wakeup_count", log=False))
            prev_wakeup_count = await Plugin.get_wakeup_count(self)
            
            if wakeup_count > prev_wakeup_count + 1:
                if await Plugin.is_streaming(self, verbose=False):
                    await asyncio.sleep(1)
                    logger.warn("Wakeup from sleep detected, restarting stream")
                    await Plugin.stop_streaming(self)
                    await Plugin.start_streaming(self)
                await Plugin.set_wakeup_count(self, wakeup_count)

            await asyncio.sleep(2)

    async def start_streaming(self):
        """Start the RTMP streaming process"""
        try:
            logger.info("Starting stream")
            
            # Clear any previous error state
            self._stream_error = False
            self._last_error_message = ""

            if await Plugin.is_streaming(self):
                logger.info("Error: Already streaming")
                return False

            # Check for valid RTMP URL based on platform
            effective_url = build_rtmp_url(self._platform, self._customRtmpUrl, self._streamKey)
            if not effective_url or not self._streamKey:
                logger.error("No RTMP URL or stream key configured")
                return False

            await Plugin.clear_rogue_gst_processes(self)

            os.environ["XDG_RUNTIME_DIR"] = "/run/user/1000"
            os.environ["XDG_SESSION_TYPE"] = "wayland"
            os.environ["HOME"] = decky_plugin.DECKY_USER_HOME
            
            # Find the correct DISPLAY for gamescope
            # Gamescope typically creates :1 for the nested X server where games run
            # Check which displays are available
            display_check = get_cmd_output("ls /tmp/.X11-unix/ 2>/dev/null")
            logger.info(f"Available X displays: {display_check}")
            
            # Build list of displays to try - prefer :1 (game content) then :0 (Steam UI)
            displays_to_try = []
            if "X1" in display_check:
                displays_to_try.append(":1")
            if "X0" in display_check:
                displays_to_try.append(":0")
            if not displays_to_try:
                displays_to_try = [":0"]  # Default fallback
            
            logger.info(f"Will try displays in order: {displays_to_try}")
            
            # Use the first available display (prefer :1 for game content)
            display_to_use = displays_to_try[0]
            os.environ["DISPLAY"] = display_to_use
            logger.info(f"Using DISPLAY={display_to_use}")

            # Build the full RTMP URL
            rtmp_full_url = build_rtmp_url(self._platform, self._customRtmpUrl, self._streamKey)
            logger.info(f"Streaming to platform: {self._platform} (key hidden)")

            # Fail fast if rtmpsink (librtmp) is not available
            if not _check_rtmpsink_available():
                logger.error("rtmpsink not available (librtmp missing)")
                self._stream_error = True
                self._last_error_message = RTMP_MISSING_MESSAGE
                return False

            # Get video scaling
            scale_caps = get_video_scale_caps(self._resolution)
            
            # Video bitrate in bits/second for GStreamer
            video_bitrate_bps = self._videoBitrate * 1000

            # Use PipeWire for video capture (matches working script)
            logger.info("Using pipewiresrc for video capture")
            
            start_command = (
                "GST_VAAPI_ALL_DRIVERS=1 GST_PLUGIN_PATH={} gst-launch-1.0 -e -vvv".format(
                    str(GSTPLUGINSPATH)
                )
            )
            
            # Video pipeline using pipewiresrc (from working script)
            # Using rtmpsink instead of rtmp2sink, simpler vaapih264enc config
            
            # Build encoder options
            encoder_opts = f"bitrate={self._videoBitrate}"
            if self._keyframeInterval > 0:
                encoder_opts += f" keyframe-period={self._keyframeInterval}"
            if self._bframes > 0:
                encoder_opts += f" max-bframes={self._bframes}"
            
            logger.info(f"Encoder options: {encoder_opts}")
            logger.info(f"Framerate: {self._framerate} fps")
            
            # Build framerate caps
            framerate_caps = f"video/x-raw,framerate={self._framerate}/1"
            
            if scale_caps:
                video_pipeline = (
                    f"pipewiresrc do-timestamp=true ! "
                    f"videoconvert ! videoscale ! videorate ! {scale_caps},framerate={self._framerate}/1 ! queue ! "
                    f"vaapih264enc {encoder_opts} ! "
                    f"h264parse ! queue ! "
                    f"flvmux name=mux ! "
                    f"rtmpsink location=\"{rtmp_full_url}\""
                )
            else:
                video_pipeline = (
                    f"pipewiresrc do-timestamp=true ! "
                    f"videoconvert ! videorate ! {framerate_caps} ! queue ! "
                    f"vaapih264enc {encoder_opts} ! "
                    f"h264parse ! queue ! "
                    f"flvmux name=mux ! "
                    f"rtmpsink location=\"{rtmp_full_url}\""
                )

            cmd = f"{start_command} {video_pipeline}"

            # Setup audio sink
            env = os.environ.copy()
            env.pop('LD_LIBRARY_PATH', None)
            env.pop('LD_PRELOAD', None)
            deckyStreamingSinkExists = subprocess.run(
                f"pactl list sinks | grep '{self._deckySinkModuleName}'", 
                shell=True, env=env
            ).returncode == 0

            if deckyStreamingSinkExists:
                logger.info(f"{self._deckySinkModuleName} already exists, rebuilding sink for safety")
                await Plugin.cleanup_decky_pa_sink(self)

            await Plugin.create_decky_pa_sink(self)

            # Audio pipeline - AAC encoded for RTMP
            audio_bitrate_bps = self._audioBitrate * 1000
            cmd = (
                cmd
                + f' pulsesrc device="{self._deckySinkModuleName}.monitor" ! '
                + f'audio/x-raw,channels=2 ! audioconvert ! '
                + f'avenc_aac bitrate={audio_bitrate_bps} ! '
                + f'mux.'
            )

            # Start the streaming process (use plugin bin for LD_LIBRARY_PATH so bundled librtmp is found)
            logger.info("Command: " + cmd)
            env = _streaming_env()
            self._streaming_process = subprocess.Popen(cmd, shell=True, stdout=std_out_file, stderr=std_err_file, env=env)
            
            # Wait a moment and check if process is still running
            await asyncio.sleep(1)
            # Process may have exited already; another task (e.g. status poll) may have set _streaming_process to None
            proc = self._streaming_process
            if proc is None:
                # Already cleared by another task (process exited quickly)
                logger.error("GStreamer process exited before startup check")
                self._stream_error = True
                try:
                    std_err_file.flush()
                    with open(std_err_file_path, 'r') as f:
                        stderr_content = f.read()
                        self._last_error_message = self._friendly_error_from_stderr(stderr_content)
                        if stderr_content and not self._last_error_message:
                            logger.error(f"GStreamer stderr: {stderr_content[:2000]}")
                except Exception as read_err:
                    self._last_error_message = "Stream ended unexpectedly (see decky-streamer-std-err.log)"
                    logger.error(f"Could not read stderr: {read_err}")
                await Plugin.cleanup_decky_pa_sink(self)
                return False
            if proc.poll() is not None:
                # Process exited immediately - something went wrong
                exit_code = proc.returncode
                logger.error(f"GStreamer exited immediately with code {exit_code}")
                self._stream_error = True
                try:
                    std_err_file.flush()
                    with open(std_err_file_path, 'r') as f:
                        stderr_content = f.read()
                        _parse_err = getattr(Plugin, "_friendly_error_from_stderr")
                        self._last_error_message = _parse_err(stderr_content) or f"Stream ended unexpectedly (exit code: {exit_code})"
                        if stderr_content:
                            logger.error(f"GStreamer stderr: {stderr_content[:2000]}")
                except Exception as read_err:
                    self._last_error_message = f"Stream ended unexpectedly (exit code: {exit_code})"
                    logger.error(f"Could not read stderr: {read_err}")
                self._streaming_process = None
                await Plugin.cleanup_decky_pa_sink(self)
                return False
            
            self._stream_start_time = time.time()
            logger.info("Streaming started!")
            return True
            
        except Exception as e:
            logger.error(f"Exception in start_streaming: {str(e)}")
            logger.error(traceback.format_exc())
            await Plugin.stop_streaming(self)
            return False

    async def stop_streaming(self):
        """Stop the streaming process"""
        logger.info("Stopping stream")
        if await Plugin.is_streaming(self) == False:
            logger.info("Error: No streaming process to stop")
            return
            
        logger.info("Sending SIGINT")
        proc = self._streaming_process
        self._streaming_process = None
        self._stream_start_time = None
        proc.send_signal(signal.SIGINT)
        logger.info("SIGINT sent. Waiting...")
        
        try:
            proc.wait(timeout=10)
        except Exception:
            logger.warn("Could not interrupt gstreamer, killing instead")
            await Plugin.clear_rogue_gst_processes(self)
            
        logger.info("Waiting finished. Streaming stopped!")
        await Plugin.cleanup_decky_pa_sink(self)
        return

    async def is_streaming(self, verbose=False):
        """Check if currently streaming"""
        if self._streaming_process is None:
            return False
        
        # Check if process is actually still running
        poll_result = self._streaming_process.poll()
        if poll_result is not None:
            # Process has exited
            exit_code = poll_result
            if exit_code != 0:
                logger.warning(f"Streaming process exited with code {exit_code}")
                self._stream_error = True
                self._last_error_message = f"Stream ended unexpectedly (exit code: {exit_code})"
            
            # Clean up
            self._streaming_process = None
            self._stream_start_time = None
            await Plugin.cleanup_decky_pa_sink(self)
            return False
        
        return True

    async def get_stream_status(self):
        """Get detailed stream status including any errors"""
        is_active = await Plugin.is_streaming(self)
        return {
            "streaming": is_active,
            "error": self._stream_error,
            "error_message": self._last_error_message,
            "duration": await Plugin.get_stream_duration(self) if is_active else 0
        }

    async def clear_stream_error(self):
        """Clear stream error state"""
        self._stream_error = False
        self._last_error_message = ""

    async def get_stream_duration(self):
        """Get how long the current stream has been running"""
        if self._stream_start_time is None:
            return 0
        return int(time.time() - self._stream_start_time)

    # Audio sink management
    async def create_decky_pa_sink(self):
        logger.debug("Creating audio pipeline")
        audio_device_output = get_cmd_output("pactl get-default-sink", log=False)

        get_cmd_output(f"pactl load-module module-null-sink sink_name={self._deckySinkModuleName}")
        get_cmd_output(f"pactl load-module module-loopback source={audio_device_output}.monitor sink={self._deckySinkModuleName}")

        if await Plugin.is_mic_enabled(self):
            await Plugin.attach_mic(self)

    async def cleanup_decky_pa_sink(self):
        unload_pa_modules("Echo-Cancelled")
        unload_pa_modules(f"{self._deckySinkModuleName}")

    # Microphone management
    async def get_default_mic(self):
        return get_cmd_output("pactl get-default-source")

    async def is_mic_enabled(self):
        return self._micEnabled

    async def is_mic_attached(self):
        env = os.environ.copy()
        env.pop('LD_LIBRARY_PATH', None)
        env.pop('LD_PRELOAD', None)
        is_attached = subprocess.run("pactl list modules | grep 'Echo-Cancelled'", shell=True, env=env).returncode == 0
        return is_attached

    async def attach_mic(self):
        logger.debug(f"Attaching Microphone {self._echoCancelledMicName}")

        if self._micSource == "NA":
            self._micSource = await Plugin.get_default_mic(self)

        if await Plugin.enhanced_noise_binary_exists(self):
            get_cmd_output(f"pactl load-module module-null-sink sink_name={self._echoCancelledMicName} rate=48000")
            get_cmd_output(f"pactl load-module module-ladspa-sink sink_name={self._echoCancelledMicName}_raw_in sink_master={self._echoCancelledMicName} label=noise_suppressor_mono plugin={self._optional_denoise_binary_path} control={self._noiseReductionPercent},20,0,0,0")
            get_cmd_output(f"pactl load-module module-loopback source={self._micSource} sink={self._echoCancelledMicName}_raw_in channels=1 source_dont_move=true sink_dont_move=true")
            get_cmd_output(f"pactl set-source-volume {self._echoCancelledMicName}.monitor {self._micGain}db")
            get_cmd_output(f"pactl load-module module-loopback source={self._echoCancelledMicName}.monitor sink={self._deckySinkModuleName}")
        else:
            audio_device_output = get_cmd_output("pactl get-default-sink")
            get_cmd_output(f"pactl load-module module-echo-cancel use_master_format=1 source_master={self._micSource} sink_master={audio_device_output} source_name={self._echoCancelledMicName} sink_name={self._echoCancelledAudioName} aec_method='webrtc' aec_args='analog_gain_control=0 digital_gain_control=1'")
            get_cmd_output(f"pactl set-source-volume Echo-Cancelled-Mic {self._micGain}db")
            get_cmd_output(f"pactl load-module module-loopback source={self._echoCancelledMicName} sink={self._deckySinkModuleName}")
            get_cmd_output(f"pactl load-module module-loopback source={self._echoCancelledAudioName}.monitor sink={self._deckySinkModuleName}")

    async def detach_mic(self):
        logger.debug(f"Detaching Microphone {self._echoCancelledMicName}")
        unload_pa_modules("Echo-Cancelled")

    async def enable_microphone(self):
        logger.debug("Enable microphone")
        if await Plugin.is_streaming(self):
            if not await Plugin.is_mic_attached(self):
                await Plugin.attach_mic(self)
        self._micEnabled = True
        await Plugin.saveConfig(self)

    async def disable_microphone(self):
        logger.debug("Disable microphone")
        if await Plugin.is_streaming(self):
            if await Plugin.is_mic_attached(self):
                await Plugin.detach_mic(self)
        self._micEnabled = False
        await Plugin.saveConfig(self)

    async def get_mic_gain(self):
        return self._micGain

    async def update_mic_gain(self, new_gain: float):
        self._micGain = float(new_gain)
        if await Plugin.is_streaming(self):
            if await Plugin.is_mic_attached(self):
                get_cmd_output(f"pactl set-source-volume Echo-Cancelled-Mic {self._micGain}db")
        await Plugin.saveConfig(self)

    async def enhanced_noise_binary_exists(self):
        return os.path.exists(self._optional_denoise_binary_path)

    async def get_noise_reduction_percent(self):
        return self._noiseReductionPercent

    async def update_noise_reduction_percent(self, new_percent: int):
        self._noiseReductionPercent = int(new_percent)
        if await Plugin.is_streaming(self):
            if await Plugin.is_mic_enabled(self):
                await Plugin.detach_mic(self)
                await Plugin.attach_mic(self)
        await Plugin.saveConfig(self)

    async def get_mic_source(self):
        return self._micSource

    async def get_mic_sources(self):
        import json
        raw_sources = get_cmd_output("pactl list short sources | awk '{print $2}'", log=False).split("\n")
        default_source = await Plugin.get_default_mic(self)
        sources_json = [{"data": f"{default_source}", "label": "Default Mic"}]
        for source in raw_sources:
            if "Echo" not in source and "monitor" not in source and "Decky" not in source and source != default_source:
                sources_json.append({"data": source, "label": source})
        return json.dumps(sources_json)

    async def set_mic_source(self, new_mic_source: str):
        logger.debug(f"Setting mic source: {new_mic_source}")
        self._micSource = new_mic_source
        if await Plugin.is_streaming(self):
            if await Plugin.is_mic_enabled(self):
                await Plugin.detach_mic(self)
                await Plugin.attach_mic(self)

    # RTMP Settings
    async def get_platform(self):
        return self._platform

    async def set_platform(self, platform: str):
        logger.debug(f"Setting platform: {platform}")
        self._platform = platform
        await Plugin.saveConfig(self)

    async def get_rtmp_url(self):
        """Get the effective RTMP URL based on platform"""
        if self._platform == "custom":
            return self._customRtmpUrl
        return self._platform_urls.get(self._platform, "")

    async def set_rtmp_url(self, rtmp_url: str):
        # This is used when switching platforms to update the effective URL
        if self._platform == "custom":
            self._customRtmpUrl = rtmp_url
        await Plugin.saveConfig(self)

    async def get_custom_rtmp_url(self):
        return self._customRtmpUrl

    async def set_custom_rtmp_url(self, rtmp_url: str):
        self._customRtmpUrl = rtmp_url
        await Plugin.saveConfig(self)

    async def get_stream_key(self):
        # Return masked version for security
        if self._streamKey:
            return "*" * 8
        return ""

    async def set_stream_key(self, stream_key: str):
        self._streamKey = stream_key
        await Plugin.saveConfig(self)

    async def get_video_bitrate(self):
        return self._videoBitrate

    async def set_video_bitrate(self, bitrate: int):
        self._videoBitrate = int(bitrate)
        await Plugin.saveConfig(self)

    async def get_audio_bitrate(self):
        return self._audioBitrate

    async def set_audio_bitrate(self, bitrate: int):
        self._audioBitrate = int(bitrate)
        await Plugin.saveConfig(self)

    async def get_resolution(self):
        return self._resolution

    async def set_resolution(self, resolution: str):
        self._resolution = resolution
        await Plugin.saveConfig(self)

    async def get_detected_resolution(self):
        """Get the current display resolution"""
        res = detect_display_resolution()
        return f"{res['width']}x{res['height']}"

    async def get_framerate(self):
        return self._framerate

    async def set_framerate(self, framerate: int):
        self._framerate = int(framerate)
        await Plugin.saveConfig(self)

    async def get_keyframe_interval(self):
        return self._keyframeInterval

    async def set_keyframe_interval(self, interval: int):
        self._keyframeInterval = int(interval)
        await Plugin.saveConfig(self)

    async def get_bframes(self):
        return self._bframes

    async def set_bframes(self, bframes: int):
        self._bframes = int(bframes)
        await Plugin.saveConfig(self)

    # Config management
    async def loadConfig(self):
        logger.debug("Loading settings")
        self._settings = SettingsManager(name="decky-streamer-settings", settings_directory=settingsDir)
        self._settings.read()

        self._platform = self._settings.getSetting("platform", "twitch")
        self._customRtmpUrl = self._settings.getSetting("custom_rtmp_url", "")
        self._streamKey = self._settings.getSetting("stream_key", "")
        self._videoBitrate = self._settings.getSetting("video_bitrate", 4500)
        self._audioBitrate = self._settings.getSetting("audio_bitrate", 160)
        self._resolution = self._settings.getSetting("resolution", "720p")
        self._framerate = self._settings.getSetting("framerate", 60)
        self._keyframeInterval = self._settings.getSetting("keyframe_interval", 0)
        self._bframes = self._settings.getSetting("bframes", 0)
        self._micEnabled = self._settings.getSetting("mic_enabled", False)
        self._micGain = self._settings.getSetting("mic_gain", 13.0)
        self._noiseReductionPercent = self._settings.getSetting("noise_reduction_percent", 50)

        await Plugin.saveConfig(self)
        return

    async def saveConfig(self):
        self._settings.setSetting("platform", self._platform)
        self._settings.setSetting("custom_rtmp_url", self._customRtmpUrl)
        self._settings.setSetting("stream_key", self._streamKey)
        self._settings.setSetting("video_bitrate", self._videoBitrate)
        self._settings.setSetting("audio_bitrate", self._audioBitrate)
        self._settings.setSetting("resolution", self._resolution)
        self._settings.setSetting("framerate", self._framerate)
        self._settings.setSetting("keyframe_interval", self._keyframeInterval)
        self._settings.setSetting("bframes", self._bframes)
        self._settings.setSetting("mic_enabled", self._micEnabled)
        self._settings.setSetting("mic_gain", self._micGain)
        self._settings.setSetting("noise_reduction_percent", self._noiseReductionPercent)
        return

    async def _main(self):
        loop = asyncio.get_event_loop()
        self._watchdog_task = loop.create_task(Plugin.watchdog(self))
        await Plugin.loadConfig(self)
        return

    async def _unload(self):
        logger.info("Unload was called")
        if await Plugin.is_streaming(self):
            logger.info("Cleaning up")
            await Plugin.stop_streaming(self)
        await Plugin.saveConfig(self)
        return
