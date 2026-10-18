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
  TextField,
  showModal,
  ConfirmModal
} from "decky-frontend-lib";

import {
  VFC,
  useState,
  useEffect
} from "react";

import { FaBroadcastTower, FaSync, FaPlus, FaEdit, FaTrash } from "react-icons/fa";

interface StreamProfile {
  id: string;
  name: string;
  platform: string;
  custom_rtmp_url?: string;
  has_stream_key?: boolean;
}

// Streaming platform presets
const STREAMING_PLATFORMS = {
  twitch: { name: "Twitch", url: "rtmp://ingest.global-contribute.live-video.net/app" },
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

// Rate control options (Twitch requires CBR)
const RATE_CONTROL_OPTIONS: DropdownOption[] = [
  { data: "cbr", label: "CBR (Constant - Recommended)" } as SingleDropdownOption,
  { data: "vbr", label: "VBR (Variable Bitrate)" } as SingleDropdownOption
];

// Keyframe interval options in seconds (Twitch strictly requires 2s)
const KEYFRAME_INTERVAL_OPTIONS: DropdownOption[] = [
  { data: 2, label: "2 seconds (Recommended)" } as SingleDropdownOption,
  { data: 1, label: "1 second" } as SingleDropdownOption,
  { data: 3, label: "3 seconds" } as SingleDropdownOption,
  { data: 4, label: "4 seconds" } as SingleDropdownOption,
  { data: 0, label: "Auto (Encoder Default)" } as SingleDropdownOption
];

// Encoder preset options
const ENCODER_PRESET_OPTIONS: DropdownOption[] = [
  { data: "ultrafast", label: "Ultrafast (Lowest CPU)" } as SingleDropdownOption,
  { data: "superfast", label: "Superfast" } as SingleDropdownOption,
  { data: "veryfast", label: "Veryfast (Recommended)" } as SingleDropdownOption,
  { data: "faster", label: "Faster" } as SingleDropdownOption,
  { data: "fast", label: "Fast" } as SingleDropdownOption,
  { data: "medium", label: "Medium (Higher Quality)" } as SingleDropdownOption
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

  getParsedMicSources = async (): Promise<SingleDropdownOption[]> => {
    const res = await this.serverAPI.callPluginMethod('get_mic_sources', {});
    if (typeof res.result === 'string') {
      try {
        return JSON.parse(res.result);
      } catch {
        return [{ data: "default", label: "Default Mic" }];
      }
    }
    return (res.result as SingleDropdownOption[]) || [{ data: "default", label: "Default Mic" }];
  }
}

const DeckyStreamer: VFC<{ serverAPI: ServerAPI, logic: DeckyStreamerLogic }> = ({ serverAPI, logic }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStreaming, setStreaming] = useState(false);
  const [streamDuration, setStreamDuration] = useState(0);
  const [streamError, setStreamError] = useState(false);
  const [streamErrorMessage, setStreamErrorMessage] = useState("");
  const [microphoneEnabled, setMicrophone] = useState(false);
  const [micGain, setMicGain] = useState(13);
  const [isEnhancedNoiseCancellation, setEnhancedNoiseCancellation] = useState(false);
  const [noiseReductionPercent, setNoiseReductionPercent] = useState(50);
  const [micSource, setMicSource] = useState<SingleDropdownOption>({ data: "default", label: "Default Mic" });
  const [micSourcesList, setMicSourcesList] = useState<SingleDropdownOption[]>([{ data: "default", label: "Default Mic" }]);
  const [isDetectingMics, setIsDetectingMics] = useState(false);

  // Stream profiles
  const [profiles, setProfiles] = useState<StreamProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("default");

  // Stream settings
  const [selectedPlatform, setSelectedPlatform] = useState("twitch");
  const [customRtmpUrl, setCustomRtmpUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [videoBitrate, setVideoBitrate] = useState(4500);
  const [selectedResolution, setSelectedResolution] = useState("720p");
  const [selectedAudioBitrate, setSelectedAudioBitrate] = useState(160);
  const [selectedFramerate, setSelectedFramerate] = useState(60);

  // Advanced settings
  const [rateControl, setRateControl] = useState("cbr");
  const [keyframeInterval, setKeyframeInterval] = useState(2);
  const [encoderPreset, setEncoderPreset] = useState("veryfast");
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

      // Load mic sources
      let initialSources: SingleDropdownOption[] = [{ data: "default", label: "Default Mic" }];
      try {
        const loadedSources = await logic.getParsedMicSources();
        if (loadedSources && loadedSources.length > 0) {
          initialSources = loadedSources;
          setMicSourcesList(loadedSources);
        }
      } catch (err) {
        console.error("Failed to load initial mic sources", err);
      }

      const getMicSource = await serverAPI.callPluginMethod('get_mic_source', {});
      const savedMicSource = (getMicSource.result as string) || "default";
      const matched = initialSources.find(s => s.data === savedMicSource);
      if (matched) {
        setMicSource(matched);
      } else {
        setMicSource(initialSources[0]);
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
      const getRateControl = await serverAPI.callPluginMethod('get_rate_control', {});
      const rateResult = getRateControl.result as string;
      setRateControl(["cbr", "vbr"].includes(rateResult) ? rateResult : "cbr");

      const getKeyframeInterval = await serverAPI.callPluginMethod('get_keyframe_interval', {});
      const keyframeResult = getKeyframeInterval.result as number;
      const normKf = keyframeResult > 10 ? 2 : keyframeResult;
      const validKeyframes = [0, 1, 2, 3, 4];
      setKeyframeInterval(validKeyframes.includes(normKf) ? normKf : 2);

      const getEncoderPreset = await serverAPI.callPluginMethod('get_encoder_preset', {});
      const presetResult = getEncoderPreset.result as string;
      const validPresets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"];
      setEncoderPreset(validPresets.includes(presetResult) ? presetResult : "veryfast");

      const getBframes = await serverAPI.callPluginMethod('get_bframes', {});
      const bframesResult = getBframes.result as number;
      const validBframes = [0, 1, 2, 3];
      setBframes(validBframes.includes(bframesResult) ? bframesResult : 0);

      // Load stream profiles
      try {
        const profilesRes = await serverAPI.callPluginMethod('get_profiles', {});
        const profilesList = (profilesRes.result as StreamProfile[]) || [];
        setProfiles(profilesList);

        const activeIdRes = await serverAPI.callPluginMethod('get_active_profile_id', {});
        const activeId = (activeIdRes.result as string) || (profilesList[0]?.id || "default");
        setActiveProfileId(activeId);
      } catch (e) {
        console.error("Failed to load stream profiles", e);
      }

      // Get detected display resolution
      const getDetectedRes = await serverAPI.callPluginMethod('get_detected_resolution', {});
      setDetectedResolution(getDetectedRes.result as string || "");
    } finally {
      setIsLoading(false);
    }
  };

  const applySettings = (settings: any) => {
    if (!settings) return;
    if (settings.platform && Object.keys(STREAMING_PLATFORMS).includes(settings.platform)) {
      setSelectedPlatform(settings.platform);
    } else {
      setSelectedPlatform("twitch");
    }
    setCustomRtmpUrl(settings.custom_rtmp_url || "");
    setStreamKey(settings.stream_key || "");

    if (typeof settings.video_bitrate === 'number' && settings.video_bitrate > 0) {
      setVideoBitrate(settings.video_bitrate);
    }
    const validAudioBitrates = [96, 128, 160, 192, 256];
    if (validAudioBitrates.includes(settings.audio_bitrate)) {
      setSelectedAudioBitrate(settings.audio_bitrate);
    }
    const validResolutions = ["native", "720p", "800p", "1080p"];
    if (validResolutions.includes(settings.resolution)) {
      setSelectedResolution(settings.resolution);
    }
    const validFramerates = [30, 60];
    if (validFramerates.includes(settings.framerate)) {
      setSelectedFramerate(settings.framerate);
    }
    if (settings.rate_control && ["cbr", "vbr"].includes(settings.rate_control)) {
      setRateControl(settings.rate_control);
    }
    if (typeof settings.keyframe_interval === 'number') {
      const kf = settings.keyframe_interval > 10 ? 2 : settings.keyframe_interval;
      setKeyframeInterval([0, 1, 2, 3, 4].includes(kf) ? kf : 2);
    }
    if (settings.encoder_preset) {
      const validPresets = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"];
      if (validPresets.includes(settings.encoder_preset)) {
        setEncoderPreset(settings.encoder_preset);
      }
    }
    const validBframes = [0, 1, 2, 3];
    if (validBframes.includes(settings.bframes)) {
      setBframes(settings.bframes);
    }
    if (typeof settings.mic_enabled === 'boolean') {
      setMicrophone(settings.mic_enabled);
    }
    if (typeof settings.mic_gain === 'number') {
      setMicGain(settings.mic_gain);
    }
    if (typeof settings.noise_reduction_percent === 'number') {
      setNoiseReductionPercent(settings.noise_reduction_percent);
    }
    if (settings.mic_source) {
      setMicSource((current) => {
        const found = micSourcesList.find(s => s.data === settings.mic_source);
        return found || current;
      });
    }
  };

  const refreshProfilesList = async (targetActiveId?: string) => {
    try {
      const profilesRes = await serverAPI.callPluginMethod('get_profiles', {});
      const profilesList = (profilesRes.result as StreamProfile[]) || [];
      setProfiles(profilesList);
      if (targetActiveId) {
        setActiveProfileId(targetActiveId);
      } else {
        const activeIdRes = await serverAPI.callPluginMethod('get_active_profile_id', {});
        const activeId = (activeIdRes.result as string) || (profilesList[0]?.id || "default");
        setActiveProfileId(activeId);
      }
    } catch (err) {
      console.error("Failed to refresh profiles", err);
    }
  };

  const switchProfile = async (profileId: string) => {
    try {
      const res = await serverAPI.callPluginMethod('switch_profile', { profile_id: profileId });
      const result = res.result as any;
      if (result && result.success) {
        setActiveProfileId(profileId);
        applySettings(result.settings);
        const switched = profiles.find(p => p.id === profileId);
        logic.notify("Profile Loaded", 1500, `Switched to ${switched?.name || "profile"}`);
      } else if (result && result.error) {
        logic.notify("Switch Failed", 2000, result.error);
      }
    } catch (err) {
      console.error("Failed to switch profile", err);
      logic.notify("Error", 2000, "Failed to switch profile");
    }
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Text input modal component for cleaner keyboard handling
  const TextInputModal = ({ title, description, currentValue, onSubmit, isPassword, closeModal }: {
    title: string;
    description?: string;
    currentValue: string;
    onSubmit: (value: string) => void;
    isPassword: boolean;
    closeModal?: () => void;
  }) => {
    const [value, setValue] = useState(currentValue);
    const defaultDesc = isPassword ? "Enter your stream key" : (title.toLowerCase().includes("url") ? "Enter the URL" : `Enter ${title.toLowerCase()}`);
    
    return (
      <ConfirmModal
        strTitle={title}
        strDescription={description || defaultDesc}
        onOK={() => {
          onSubmit(value);
          closeModal?.();
        }}
        onCancel={() => closeModal?.()}
        bAllowFullSize={true}
      >
        <div style={{ padding: '10px 0' }}>
          <TextField
            value={value}
            onChange={(e) => setValue(e.target.value)}
            bIsPassword={isPassword}
            focusOnMount={true}
          />
        </div>
      </ConfirmModal>
    );
  };

  // Show text input modal using Steam's keyboard
  const showTextInputModal = (
    title: string,
    currentValue: string,
    onSubmit: (value: string) => void,
    isPassword: boolean = false,
    description?: string
  ) => {
    showModal(
      <TextInputModal
        title={title}
        description={description}
        currentValue={currentValue}
        onSubmit={onSubmit}
        isPassword={isPassword}
      />
    );
  };

  const showDeleteConfirmModal = (profileName: string, onConfirm: () => void) => {
    showModal(
      <ConfirmModal
        strTitle="Delete Profile"
        strDescription={`Are you sure you want to delete profile "${profileName}"? This cannot be undone.`}
        strOKButtonText="Delete"
        bDestructiveWarning={true}
        onOK={() => onConfirm()}
      />
    );
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
      // Clear any previous error state
      setStreamError(false);
      setStreamErrorMessage("");
      await serverAPI.callPluginMethod('clear_stream_error', {});
      
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
      setStreamError(false);
      setStreamErrorMessage("");
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

  // Active background microphone polling while microphone is enabled
  useEffect(() => {
    if (!microphoneEnabled) return;
    const interval = setInterval(async () => {
      try {
        const updated = await logic.getParsedMicSources();
        if (updated && updated.length > 0) {
          setMicSourcesList(updated);
          setMicSource((current) => {
            const exists = updated.find(s => s.data === current.data);
            return exists || updated[0];
          });
        }
      } catch (err) {
        console.error("Background mic poll error", err);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [microphoneEnabled]);

  const detectMicrophones = async () => {
    setIsDetectingMics(true);
    try {
      const updated = await logic.getParsedMicSources();
      if (updated && updated.length > 0) {
        setMicSourcesList(updated);
        setMicSource((current) => {
          const exists = updated.find(s => s.data === current.data);
          return exists || updated[0];
        });

        const physicalCount = updated.filter(s => s.data !== "default").length;
        serverAPI.toaster.toast({
          title: "Microphone Detection",
          body: physicalCount > 0
            ? `Found ${physicalCount} microphone(s)`
            : "No external mics found, using default",
          duration: 3000
        });
      }
    } catch (err) {
      serverAPI.toaster.toast({
        title: "Detection Failed",
        body: "Unable to query microphones",
        duration: 3000
      });
    } finally {
      setIsDetectingMics(false);
    }
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
    
    // Poll for stream status every second when streaming, every 2 seconds otherwise
    const pollInterval = isStreaming ? 1000 : 2000;
    
    interval = setInterval(async () => {
      const status = await serverAPI.callPluginMethod('get_stream_status', {});
      const statusResult = status.result as { streaming: boolean; error: boolean; error_message: string; duration: number } | null;
      
      if (statusResult) {
        // Update streaming state if it changed (e.g., process crashed)
        if (statusResult.streaming !== isStreaming) {
          setStreaming(statusResult.streaming);
        }
        
        // Update duration
        setStreamDuration(statusResult.duration);
        
        // Handle errors
        if (statusResult.error && !streamError) {
          setStreamError(true);
          setStreamErrorMessage(statusResult.error_message || "Stream connection lost");
          logic.notify("Stream Error", 5000, statusResult.error_message || "Stream connection lost");
        }
      }
    }, pollInterval);

    // Reset duration when not streaming
    if (!isStreaming) {
      setStreamDuration(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isStreaming, serverAPI, streamError, logic]);

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

        {streamError && !isStreaming && (
          <PanelSectionRow>
            <div style={{ textAlign: 'center', color: '#ffaa00', padding: '8px', backgroundColor: 'rgba(255, 170, 0, 0.1)', borderRadius: '4px' }}>
              ⚠️ Stream ended: {streamErrorMessage || "Connection lost"}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Stream Profiles">
        <PanelSectionRow>
          <Dropdown
            rgOptions={profiles.map(p => ({ data: p.id, label: p.name } as SingleDropdownOption))}
            selectedOption={
              profiles.map(p => ({ data: p.id, label: p.name } as SingleDropdownOption))
                .find(o => o.data === activeProfileId) || { data: activeProfileId, label: profiles[0]?.name || "Default" }
            }
            strDefaultLabel={profiles.find(p => p.id === activeProfileId)?.name || "Select Profile"}
            disabled={isStreaming}
            onChange={async (option) => {
              await switchProfile(option.data as string);
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Switch between saved stream configurations
          </div>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={isStreaming}
            onClick={() => {
              showTextInputModal(
                "Create New Profile",
                "",
                async (profileName) => {
                  const trimmed = profileName.trim();
                  if (!trimmed) return;
                  const res = await serverAPI.callPluginMethod('create_profile', {
                    name: trimmed,
                    copy_current: false
                  });
                  const result = res.result as any;
                  if (result && result.success) {
                    if (result.settings) {
                      applySettings(result.settings);
                    }
                    await refreshProfilesList(result.active_profile_id);
                    logic.notify("Profile Created", 1500, `Created new profile "${trimmed}"`);
                  }
                },
                false,
                "Enter a name for the new profile (starts with Twitch broadcasting standards)"
              );
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <FaPlus />
              <span>Create New Profile</span>
            </div>
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={isStreaming}
            onClick={() => {
              const currentProfile = profiles.find(p => p.id === activeProfileId);
              showTextInputModal(
                "Rename Profile",
                currentProfile?.name || "",
                async (newName) => {
                  const trimmed = newName.trim();
                  if (!trimmed) return;
                  const res = await serverAPI.callPluginMethod('rename_profile', {
                    profile_id: activeProfileId,
                    new_name: trimmed
                  });
                  const result = res.result as any;
                  if (result && result.success) {
                    await refreshProfilesList(activeProfileId);
                    logic.notify("Profile Renamed", 1500, `Renamed to "${trimmed}"`);
                  }
                },
                false,
                "Enter new name for profile"
              );
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <FaEdit />
              <span>Rename Active Profile</span>
            </div>
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={isStreaming || profiles.length <= 1}
            onClick={() => {
              const currentProfile = profiles.find(p => p.id === activeProfileId);
              showDeleteConfirmModal(
                currentProfile?.name || "Current",
                async () => {
                  const res = await serverAPI.callPluginMethod('delete_profile', {
                    profile_id: activeProfileId
                  });
                  const result = res.result as any;
                  if (result && result.success) {
                    if (result.settings) {
                      applySettings(result.settings);
                    }
                    await refreshProfilesList(result.active_profile_id);
                    logic.notify("Profile Deleted", 1500, `Deleted profile "${currentProfile?.name || ''}"`);
                  }
                }
              );
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <FaTrash />
              <span>Delete Active Profile</span>
            </div>
          </ButtonItem>
        </PanelSectionRow>
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
              <ButtonItem
                layout="below"
                disabled={isStreaming}
                onClick={() => {
                  showTextInputModal("RTMP URL", customRtmpUrl, async (value) => {
                    setCustomRtmpUrl(value);
                    await serverAPI.callPluginMethod('set_custom_rtmp_url', { rtmp_url: value });
                    await serverAPI.callPluginMethod('set_rtmp_url', { rtmp_url: value });
                  });
                }}
              >
                {customRtmpUrl ? "••••••••••••" : "Tap to enter RTMP URL..."}
              </ButtonItem>
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', color: '#888' }}>
                Tap to enter your custom RTMP server URL
              </div>
            </PanelSectionRow>
          </>
        )}

        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={isStreaming}
            onClick={() => {
              showTextInputModal("Stream Key", streamKey.startsWith("*") ? "" : streamKey, async (value) => {
                if (!value || value === "********") return;
                setStreamKey(value);
                await serverAPI.callPluginMethod('set_stream_key', { stream_key: value });
              }, true);
            }}
          >
            {streamKey ? "••••••••••••" : "Tap to enter Stream Key..."}
          </ButtonItem>
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
                rgOptions={RATE_CONTROL_OPTIONS}
                selectedOption={getSelectedOption(RATE_CONTROL_OPTIONS, rateControl)}
                strDefaultLabel={getSelectedOption(RATE_CONTROL_OPTIONS, rateControl).label as string}
                disabled={isStreaming}
                onChange={(option) => {
                  const value = option.data as string;
                  setRateControl(value);
                  serverAPI.callPluginMethod('set_rate_control', { rate_control: value });
                }}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', color: '#888' }}>
                Rate control (CBR is required by Twitch to prevent disconnects)
              </div>
            </PanelSectionRow>

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
                Keyframe interval (Twitch requires 2 seconds)
              </div>
            </PanelSectionRow>

            <PanelSectionRow>
              <Dropdown
                rgOptions={ENCODER_PRESET_OPTIONS}
                selectedOption={getSelectedOption(ENCODER_PRESET_OPTIONS, encoderPreset)}
                strDefaultLabel={getSelectedOption(ENCODER_PRESET_OPTIONS, encoderPreset).label as string}
                disabled={isStreaming}
                onChange={(option) => {
                  const value = option.data as string;
                  setEncoderPreset(value);
                  serverAPI.callPluginMethod('set_encoder_preset', { preset: value });
                }}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', color: '#888' }}>
                Encoder preset (trades speed vs compression efficiency)
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
                B-frames improve quality (Twitch allows up to 2; 0 minimizes latency)
              </div>
            </PanelSectionRow>
          </>
        )}

        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={isStreaming || isRefreshing}
            onClick={async () => {
              setIsRefreshing(true);
              try {
                // Force reload from backend
                await serverAPI.callPluginMethod('loadConfig', {});
                // Small delay to ensure backend has loaded
                await new Promise(resolve => setTimeout(resolve, 100));
                // Reload all state
                await initState();
                logic.notify("Settings Refreshed", 1500, "Settings reloaded from config");
              } finally {
                setIsRefreshing(false);
              }
            }}
          >
            {isRefreshing ? "⏳ Refreshing..." : "🔄 Refresh Settings"}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: '12px', color: '#888' }}>
            Reload settings from config file
          </div>
        </PanelSectionRow>
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
                strDefaultLabel={(micSource.label as string) || "Default Mic"}
                onChange={(newSource) => {
                  setMicSource({ data: newSource.data as string, label: newSource.label as string });
                  serverAPI.callPluginMethod('set_mic_source', { new_mic_source: newSource.data });
                }}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                onClick={detectMicrophones}
                disabled={isDetectingMics}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <FaSync className={isDetectingMics ? "spinning" : ""} />
                  <span>{isDetectingMics ? "Detecting Microphones..." : "Detect Microphones"}</span>
                </div>
              </ButtonItem>
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={{ fontSize: '12px', color: '#888' }}>
                Select a specific microphone or leave on default. Click Detect Microphones if your USB mic is not listed.
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
