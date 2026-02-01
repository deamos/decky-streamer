import {
  ButtonItem,
  definePlugin,
  PanelSection,
  PanelSectionRow,
  ServerAPI,
  staticClasses,
  Dropdown,
  DropdownOption,
  SingleDropdownOption,
  Router,
  ToggleField,
  SliderField,
  TextField
} from "decky-frontend-lib";

import {
  VFC,
  useState,
  useEffect
} from "react";

import { FaBroadcastTower } from "react-icons/fa";

// Streaming platform presets
const STREAMING_PLATFORMS = {
  twitch: { name: "Twitch", url: "rtmp://live.twitch.tv/app" },
  youtube: { name: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2" },
  kick: { name: "Kick", url: "rtmp://fa723fc1b171.global-contribute.live-video.net/app" },
  facebook: { name: "Facebook", url: "rtmps://live-api-s.facebook.com:443/rtmp" },
  custom: { name: "Custom", url: "" }
};

// Platform dropdown options (defined outside component for stable reference)
const PLATFORM_OPTIONS: DropdownOption[] = Object.entries(STREAMING_PLATFORMS).map(([key, value]) => ({
  data: key,
  label: value.name
} as SingleDropdownOption));

// Base resolution options (native will be added dynamically with detected resolution)
const BASE_RESOLUTION_OPTIONS: DropdownOption[] = [
  { data: "native", label: "Native (Display)" } as SingleDropdownOption,
  { data: "720p", label: "720p (1280x720)" } as SingleDropdownOption,
  { data: "800p", label: "800p (1280x800)" } as SingleDropdownOption,
  { data: "1080p", label: "1080p (1920x1080)" } as SingleDropdownOption
];

// Audio bitrate options (defined outside component for stable reference)
const AUDIO_BITRATE_OPTIONS: DropdownOption[] = [
  { data: 96, label: "96 kbps" } as SingleDropdownOption,
  { data: 128, label: "128 kbps" } as SingleDropdownOption,
  { data: 160, label: "160 kbps" } as SingleDropdownOption,
  { data: 192, label: "192 kbps" } as SingleDropdownOption,
  { data: 256, label: "256 kbps" } as SingleDropdownOption
];

// Framerate options
const FRAMERATE_OPTIONS: DropdownOption[] = [
  { data: 30, label: "30 fps" } as SingleDropdownOption,
  { data: 60, label: "60 fps" } as SingleDropdownOption
];

// Keyframe interval options (0 = encoder default)
const KEYFRAME_INTERVAL_OPTIONS: DropdownOption[] = [
  { data: 0, label: "Default" } as SingleDropdownOption,
  { data: 30, label: "30 (1s @ 30fps)" } as SingleDropdownOption,
  { data: 60, label: "60 (2s @ 30fps)" } as SingleDropdownOption,
  { data: 120, label: "120 (2s @ 60fps)" } as SingleDropdownOption,
  { data: 250, label: "250 (~4s @ 60fps)" } as SingleDropdownOption
];

// B-frames options (0 = encoder default which is typically 0)
const BFRAMES_OPTIONS: DropdownOption[] = [
  { data: 0, label: "Default (0)" } as SingleDropdownOption,
  { data: 1, label: "1" } as SingleDropdownOption,
  { data: 2, label: "2" } as SingleDropdownOption,
  { data: 3, label: "3" } as SingleDropdownOption
];

// Helper function to safely get an option from the list, always returning a valid option
const getSelectedOption = <T,>(options: DropdownOption[], value: T | null | undefined): DropdownOption => {
  if (value === null || value === undefined) {
    return options[0];
  }
  const found = options.find(o => o.data === value);
  return found || options[0];
};

class DeckyStreamerLogic {
  serverAPI: ServerAPI;

  constructor(serverAPI: ServerAPI) {
    this.serverAPI = serverAPI;
  }

  notify = async (message: string, duration: number = 1000, body: string = "") => {
    if (!body) {
      body = message;
    }
    await this.serverAPI.toaster.toast({
      title: message,
      body: body,
      duration: duration,
      critical: true
    });
  }

  toggleMicrophone = async (microphoneEnabled: boolean) => {
    if (!microphoneEnabled) {
      await this.serverAPI.callPluginMethod('enable_microphone', {});
    } else {
      await this.serverAPI.callPluginMethod('disable_microphone', {});
    }
  }

  updateMicGain = async (newMicGain: number) => {
    await this.serverAPI.callPluginMethod('update_mic_gain', { new_gain: newMicGain });
  }

  updateNoiseReductionPercent = async (newNoiseReductionPercent: number) => {
    await this.serverAPI.callPluginMethod('update_noise_reduction_percent', { new_percent: newNoiseReductionPercent });
  }

  getParsedMicSources = async () => {
    return JSON.parse((await this.serverAPI.callPluginMethod('get_mic_sources', {})).result as string);
  }
}

const DeckyStreamer: VFC<{ serverAPI: ServerAPI, logic: DeckyStreamerLogic }> = ({ serverAPI, logic }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setStreaming] = useState(false);
  const [streamDuration, setStreamDuration] = useState(0);
  const [microphoneEnabled, setMicrophone] = useState(false);
  const [micGain, setMicGain] = useState(13);
  const [isEnhancedNoiseCancellation, setEnhancedNoiseCancellation] = useState(false);
  const [noiseReductionPercent, setNoiseReductionPercent] = useState(50);
  const [micSource, setMicSource] = useState({ data: "NA", label: "Default Mic" });
  const [micSourcesList, setMicSourcesList] = useState([{ data: "NA", label: "Default Mic" }]);

  // Stream settings
  const [selectedPlatform, setSelectedPlatform] = useState("twitch");
  const [customRtmpUrl, setCustomRtmpUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [videoBitrate, setVideoBitrate] = useState(4500);
  const [selectedResolution, setSelectedResolution] = useState("720p");
  const [selectedAudioBitrate, setSelectedAudioBitrate] = useState(160);
  const [selectedFramerate, setSelectedFramerate] = useState(60);

  // Advanced settings
  const [keyframeInterval, setKeyframeInterval] = useState(0);
  const [bframes, setBframes] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [detectedResolution, setDetectedResolution] = useState("");

  // Build resolution options with dynamic native label
  const getResolutionOptions = (): DropdownOption[] => {
    return BASE_RESOLUTION_OPTIONS.map(opt => {
      if (opt.data === "native" && detectedResolution) {
        return { data: "native", label: `Native (${detectedResolution})` } as SingleDropdownOption;
      }
      return opt;
    });
  };

  // Get the effective RTMP URL based on selection
  const getEffectiveRtmpUrl = (): string => {
    if (selectedPlatform === "custom") {
      return customRtmpUrl;
    }
    return STREAMING_PLATFORMS[selectedPlatform as keyof typeof STREAMING_PLATFORMS]?.url || "";
  };

  const initState = async () => {
    try {
      const getIsStreamingResponse = await serverAPI.callPluginMethod('is_streaming', {});
      setStreaming(getIsStreamingResponse.result === true);

      const getMicEnabled = await serverAPI.callPluginMethod('is_mic_enabled', {});
      setMicrophone(getMicEnabled.result === true);

      const getMicGain = await serverAPI.callPluginMethod('get_mic_gain', {});
      setMicGain(typeof getMicGain.result === 'number' ? getMicGain.result : 13);

      const getEnhancedNoiseCancellation = await serverAPI.callPluginMethod('enhanced_noise_binary_exists', {});
      setEnhancedNoiseCancellation(getEnhancedNoiseCancellation.result === true);

      const getNoiseReductionPercent = await serverAPI.callPluginMethod('get_noise_reduction_percent', {});
      setNoiseReductionPercent(typeof getNoiseReductionPercent.result === 'number' ? getNoiseReductionPercent.result : 50);

      let getMicSource = await serverAPI.callPluginMethod('get_mic_source', {});
      const micSourceResult = getMicSource.result as string;
      if (!micSourceResult || micSourceResult === "NA") {
        getMicSource = await serverAPI.callPluginMethod('get_default_mic', {});
        setMicSource({ data: getMicSource.result as string || "NA", label: "Default Mic" });
      } else if (micSourceResult.includes("alsa_input")) {
        setMicSource({ data: micSourceResult, label: "Default Mic" });
      } else {
        setMicSource({ data: micSourceResult, label: micSourceResult });
      }

      // Load stream settings
      const getPlatform = await serverAPI.callPluginMethod('get_platform', {});
      const platform = getPlatform.result as string;
      if (platform && Object.keys(STREAMING_PLATFORMS).includes(platform)) {
        setSelectedPlatform(platform);
      } else {
        setSelectedPlatform("twitch"); // Ensure we always have a valid platform
      }

      const getCustomUrl = await serverAPI.callPluginMethod('get_custom_rtmp_url', {});
      setCustomRtmpUrl(getCustomUrl.result as string || "");

      const getStreamKey = await serverAPI.callPluginMethod('get_stream_key', {});
      setStreamKey(getStreamKey.result as string || "");

      const getVideoBitrate = await serverAPI.callPluginMethod('get_video_bitrate', {});
      setVideoBitrate(typeof getVideoBitrate.result === 'number' && getVideoBitrate.result > 0 ? getVideoBitrate.result : 4500);

      const getAudioBitrate = await serverAPI.callPluginMethod('get_audio_bitrate', {});
      const audioBitrateResult = getAudioBitrate.result as number;
      // Ensure it's a valid option
      const validAudioBitrates = [96, 128, 160, 192, 256];
      setSelectedAudioBitrate(validAudioBitrates.includes(audioBitrateResult) ? audioBitrateResult : 160);

      const getResolution = await serverAPI.callPluginMethod('get_resolution', {});
      const resolutionResult = getResolution.result as string;
      // Ensure it's a valid option
      const validResolutions = ["native", "720p", "800p", "1080p"];
      setSelectedResolution(validResolutions.includes(resolutionResult) ? resolutionResult : "720p");

      const getFramerate = await serverAPI.callPluginMethod('get_framerate', {});
      const framerateResult = getFramerate.result as number;
      // Ensure it's a valid option
      const validFramerates = [30, 60];
      setSelectedFramerate(validFramerates.includes(framerateResult) ? framerateResult : 60);

      // Load advanced settings
      const getKeyframeInterval = await serverAPI.callPluginMethod('get_keyframe_interval', {});
      const keyframeResult = getKeyframeInterval.result as number;
      const validKeyframes = [0, 30, 60, 120, 250];
      setKeyframeInterval(validKeyframes.includes(keyframeResult) ? keyframeResult : 0);

      const getBframes = await serverAPI.callPluginMethod('get_bframes', {});
      const bframesResult = getBframes.result as number;
      const validBframes = [0, 1, 2, 3];
      setBframes(validBframes.includes(bframesResult) ? bframesResult : 0);

      // Get detected display resolution
      const getDetectedRes = await serverAPI.callPluginMethod('get_detected_resolution', {});
      setDetectedResolution(getDetectedRes.result as string || "");
    } finally {
      setIsLoading(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const streamButtonPress = async () => {
    if (!isStreaming) {
      const effectiveUrl = getEffectiveRtmpUrl();
      if (!effectiveUrl) {
        logic.notify("Error", 2000, "Please configure RTMP URL first");
        return;
      }
      if (!streamKey) {
        logic.notify("Error", 2000, "Please enter your stream key");
        return;
      }
      setStreaming(true);
      const result = await serverAPI.callPluginMethod('start_streaming', {});
      if (result.result) {
        const platformOption = PLATFORM_OPTIONS.find(p => p.data === selectedPlatform);
        const platformName = platformOption?.label || "RTMP";
        logic.notify("Stream Started", 1500, `Now live on ${platformName}!`);
        Router.CloseSideMenus();
      } else {
        setStreaming(false);
        logic.notify("Stream Failed", 2000, "Could not start stream");
      }
    } else {
      await serverAPI.callPluginMethod('stop_streaming', {});
      setStreaming(false);
      logic.notify("Stream Ended", 1500, "Stream has been stopped");
    }
  };

  const microphoneToggled = async () => {
    logic.toggleMicrophone(microphoneEnabled);
  };

  const changeMicGain = async () => {
    logic.updateMicGain(micGain);
  };

  const changeNoiseReductionPercent = async () => {
    logic.updateNoiseReductionPercent(noiseReductionPercent);
  };

  const getMicSources = async () => {
    const parsedMicSources = await logic.getParsedMicSources();
    setMicSourcesList(parsedMicSources);
  };

  const getStreamButtonText = (): string => {
    if (!isStreaming) {
      return "Start Streaming";
    } else {
      return "Stop Streaming";
    }
  };

  const canStream = (): boolean => {
    const effectiveUrl = getEffectiveRtmpUrl();
    return effectiveUrl.length > 0 && streamKey.length > 0;
  };

  const handlePlatformChange = (platform: string) => {
    setSelectedPlatform(platform);
    serverAPI.callPluginMethod('set_platform', { platform });
    // Update the effective RTMP URL on the backend
    const url = STREAMING_PLATFORMS[platform as keyof typeof STREAMING_PLATFORMS]?.url || "";
    if (platform !== "custom") {
      serverAPI.callPluginMethod('set_rtmp_url', { rtmp_url: url });
    }
  };

  // Update stream duration every second when streaming
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (isStreaming) {
      interval = setInterval(async () => {
        const duration = await serverAPI.callPluginMethod('get_stream_duration', {});
        setStreamDuration(duration.result as number);
      }, 1000);
    } else {
      setStreamDuration(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStreaming, serverAPI]);

  useEffect(() => {
    initState();
  }, []);

  if (isLoading) {
    return (
      <div>
        <PanelSection title="Decky Streamer">
          <PanelSectionRow>
            <div style={{ textAlign: 'center', padding: '20px' }}>
              Loading settings...
            </div>
          </PanelSectionRow>
        </PanelSection>
      </div>
    );
  }

  return (
    <div>
      <PanelSection title="Stream Control">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={!canStream()}
            onClick={() => { streamButtonPress(); }}
          >
            {getStreamButtonText()}
          </ButtonItem>
        </PanelSectionRow>

        {isStreaming && (
          <PanelSectionRow>
            <div style={{ textAlign: 'center', color: '#ff4444', fontWeight: 'bold' }}>
              🔴 LIVE - {formatDuration(streamDuration)}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Stream Settings">
        <PanelSectionRow>
          <Dropdown
            rgOptions={PLATFORM_OPTIONS}
            selectedOption={getSelectedOption(PLATFORM_OPTIONS, selectedPlatform)}
            strDefaultLabel={getSelectedOption(PLATFORM_OPTIONS, selectedPlatform).label as string}
            disabled={isStreaming}
            onChange={(option) => handlePlatformChange(option.data as string)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Select your streaming platform
          </div>
        </PanelSectionRow>

        {selectedPlatform === "custom" && (
          <>
            <PanelSectionRow>
              <TextField
                label="RTMP URL"
                value={customRtmpUrl}
                disabled={isStreaming}
                onChange={async (e) => {
                  const value = e.target.value;
                  setCustomRtmpUrl(value);
                  await serverAPI.callPluginMethod('set_custom_rtmp_url', { rtmp_url: value });
                  await serverAPI.callPluginMethod('set_rtmp_url', { rtmp_url: value });
                }}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', color: '#888' }}>
                Enter your custom RTMP server URL
              </div>
            </PanelSectionRow>
          </>
        )}

        <PanelSectionRow>
          <TextField
            label="Stream Key"
            value={streamKey}
            disabled={isStreaming}
            onChange={async (e) => {
              const value = e.target.value;
              setStreamKey(value);
              await serverAPI.callPluginMethod('set_stream_key', { stream_key: value });
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Get this from your streaming platform's dashboard
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <SliderField
            label="Video Bitrate (kbps)"
            value={videoBitrate}
            min={1000}
            max={8000}
            step={500}
            disabled={isStreaming}
            showValue={true}
            onChange={async (value) => {
              setVideoBitrate(value);
              await serverAPI.callPluginMethod('set_video_bitrate', { bitrate: value });
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Recommended: 4500 for 720p, 6000 for 1080p
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <Dropdown
            rgOptions={getResolutionOptions()}
            selectedOption={getSelectedOption(getResolutionOptions(), selectedResolution)}
            strDefaultLabel={getSelectedOption(getResolutionOptions(), selectedResolution).label as string}
            disabled={isStreaming}
            onChange={(newResolution) => {
              const value = newResolution.data as string;
              setSelectedResolution(value);
              serverAPI.callPluginMethod('set_resolution', { resolution: value });
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Output resolution for stream
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <Dropdown
            rgOptions={FRAMERATE_OPTIONS}
            selectedOption={getSelectedOption(FRAMERATE_OPTIONS, selectedFramerate)}
            strDefaultLabel={getSelectedOption(FRAMERATE_OPTIONS, selectedFramerate).label as string}
            disabled={isStreaming}
            onChange={(newFramerate) => {
              const value = newFramerate.data as number;
              setSelectedFramerate(value);
              serverAPI.callPluginMethod('set_framerate', { framerate: value });
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Output framerate for stream
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <Dropdown
            rgOptions={AUDIO_BITRATE_OPTIONS}
            selectedOption={getSelectedOption(AUDIO_BITRATE_OPTIONS, selectedAudioBitrate)}
            strDefaultLabel={getSelectedOption(AUDIO_BITRATE_OPTIONS, selectedAudioBitrate).label as string}
            disabled={isStreaming}
            onChange={(newBitrate) => {
              const value = newBitrate.data as number;
              setSelectedAudioBitrate(value);
              serverAPI.callPluginMethod('set_audio_bitrate', { bitrate: value });
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Audio bitrate for stream
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <ToggleField
            label="Show Advanced Options"
            checked={showAdvanced}
            onChange={(e) => setShowAdvanced(e)}
          />
        </PanelSectionRow>

        {showAdvanced && (
          <>
            <PanelSectionRow>
              <Dropdown
                rgOptions={KEYFRAME_INTERVAL_OPTIONS}
                selectedOption={getSelectedOption(KEYFRAME_INTERVAL_OPTIONS, keyframeInterval)}
                strDefaultLabel={getSelectedOption(KEYFRAME_INTERVAL_OPTIONS, keyframeInterval).label as string}
                disabled={isStreaming}
                onChange={(option) => {
                  const value = option.data as number;
                  setKeyframeInterval(value);
                  serverAPI.callPluginMethod('set_keyframe_interval', { interval: value });
                }}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', color: '#888' }}>
                GOP size (keyframe frequency)
              </div>
            </PanelSectionRow>

            <PanelSectionRow>
              <Dropdown
                rgOptions={BFRAMES_OPTIONS}
                selectedOption={getSelectedOption(BFRAMES_OPTIONS, bframes)}
                strDefaultLabel={getSelectedOption(BFRAMES_OPTIONS, bframes).label as string}
                disabled={isStreaming}
                onChange={(option) => {
                  const value = option.data as number;
                  setBframes(value);
                  serverAPI.callPluginMethod('set_bframes', { bframes: value });
                }}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', color: '#888' }}>
                B-frames improve quality but add latency
              </div>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>

      <PanelSection title="Microphone">
        <PanelSectionRow>
          <ToggleField
            label="Enable Microphone"
            checked={microphoneEnabled}
            onChange={(e) => { setMicrophone(e); microphoneToggled(); }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Include echo-cancelled microphone in stream
          </div>
        </PanelSectionRow>

        {microphoneEnabled && (
          <>
            <PanelSectionRow>
              <SliderField
                label="Mic Gain (dB)"
                value={micGain}
                min={0}
                max={30}
                step={1}
                showValue={true}
                onChange={(e) => { setMicGain(e); changeMicGain(); }}
              />
            </PanelSectionRow>

            {isEnhancedNoiseCancellation && (
              <PanelSectionRow>
                <SliderField
                  label="Noise Reduction %"
                  value={noiseReductionPercent}
                  min={0}
                  max={100}
                  step={5}
                  showValue={true}
                  onChange={(e) => { setNoiseReductionPercent(e); changeNoiseReductionPercent(); }}
                />
              </PanelSectionRow>
            )}

            <PanelSectionRow>
              <Dropdown
                rgOptions={micSourcesList}
                selectedOption={micSourcesList.find(m => m.data === micSource.data) || micSourcesList[0]}
                strDefaultLabel={micSource.label || "Default Mic"}
                onMenuWillOpen={async (showMenu: () => void) => {
                  await getMicSources();
                  showMenu();
                }}
                onChange={(newSource) => {
                  setMicSource({ data: newSource.data as string, label: newSource.label as string });
                  serverAPI.callPluginMethod('set_mic_source', { new_mic_source: newSource.data });
                }}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', color: '#888' }}>
                Select the Microphone Source
              </div>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>
    </div>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  const logic = new DeckyStreamerLogic(serverApi);

  return {
    title: <div className={staticClasses.Title}>Decky Streamer</div>,
    content: <DeckyStreamer serverAPI={serverApi} logic={logic} />,
    icon: <FaBroadcastTower />,
    onDismount() {
      // Cleanup if needed
    },
    alwaysRender: true
  };
});
