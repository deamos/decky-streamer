#!/usr/bin/env bash
# Collect GStreamer runtime and required-element diagnostics without starting a stream.
# Run with: bash gst-diagnostics.sh > gst-diagnostics.log 2>&1
set -u

say() { printf '\n===== %s =====\n' "$*"; }

say "OS"
if [[ -r /etc/os-release ]]; then
    cat /etc/os-release
else
    echo "/etc/os-release not readable"
fi
uname -a

say "GStreamer executables"
for bin in gst-launch-1.0 gst-inspect-1.0; do
    if command -v "$bin" >/dev/null 2>&1; then
        printf '%s: %s\n' "$bin" "$(command -v "$bin")"
    else
        printf '%s: NOT FOUND\n' "$bin"
    fi
done

if ! command -v gst-launch-1.0 >/dev/null 2>&1 || ! command -v gst-inspect-1.0 >/dev/null 2>&1; then
    echo "Cannot continue: install/provide the system GStreamer command-line tools."
    exit 1
fi

say "GStreamer version"
gst-launch-1.0 --version 2>&1

# Mirror the system-runtime selection used by the testing branch: do not add the
# SteamOS-built bundled plugin directory to the host plugin search path.
plugin_dirs=()
for candidate in /usr/lib/gstreamer-1.0 /usr/lib64/gstreamer-1.0; do
    if [[ -d "$candidate" ]]; then
        plugin_dirs+=("$candidate")
    fi
done
library_dirs=()
for candidate in /usr/lib /usr/lib64; do
    if [[ -d "$candidate" ]]; then
        library_dirs+=("$candidate")
    fi
done

if ((${#plugin_dirs[@]})); then
    export GST_PLUGIN_PATH="$(IFS=:; echo "${plugin_dirs[*]}")"
else
    unset GST_PLUGIN_PATH || true
fi
if ((${#library_dirs[@]})); then
    export LD_LIBRARY_PATH="$(IFS=:; echo "${library_dirs[*]}")"
else
    unset LD_LIBRARY_PATH || true
fi
export LD_PRELOAD=""
export GST_DEBUG=2
export GST_DEBUG_NO_COLOR=1
registry_file="$(mktemp "${TMPDIR:-/tmp}/decky-streamer-gst-registry.XXXXXX")"
export GST_REGISTRY="$registry_file"
trap 'rm -f "$registry_file"' EXIT

say "Diagnostic environment (no stream keys or URLs are read)"
printf 'GST_PLUGIN_PATH=%s\n' "${GST_PLUGIN_PATH:-<unset; GStreamer default paths> }"
printf 'LD_LIBRARY_PATH=%s\n' "${LD_LIBRARY_PATH:-<unset; loader defaults>}"
printf 'GST_REGISTRY=%s (temporary)\n' "$GST_REGISTRY"
printf 'GST_DEBUG=%s\n' "$GST_DEBUG"
printf 'Bundled plugin directory exists: '
if [[ -d "$(dirname "$0")/bin/gstreamer-1.0" ]]; then echo yes; else echo no; fi

say "Required and fallback pipeline elements"
missing=0
for element in \
    pipewiresrc videoconvert videoscale videorate queue \
    vaapih264enc x264enc h264parse h264timestamper flvmux \
    rtmpsink rtmp2sink pulsesrc audioconvert audioresample audiorate \
    avenc_aac fdkaacenc faac voaacenc aacparse; do
    printf '\n--- gst-inspect-1.0 %s ---\n' "$element"
    if gst-inspect-1.0 "$element"; then
        :
    else
        rc=$?
        printf 'RESULT: unavailable (exit %s)\n' "$rc"
        case "$element" in
            x264enc|h264timestamper|rtmp2sink|fdkaacenc|faac|voaacenc) ;;
            *) missing=1 ;;
        esac
    fi
done

say "End of diagnostics"
echo "GST_DEBUG=2 was enabled for plugin discovery and gst-inspect. No capture pipeline was started."
echo "Attach this complete output to the bug report; redact usernames/hostnames if desired."
exit "$missing"
