def _streaming_env():
    """Build env for GStreamer subprocess. Prefer the system runtime and never mix it with the bundled plugin dir."""
    env = os.environ.copy()
    env.pop("LD_PRELOAD", None)
    runtime = _gst_runtime_settings()
    env["LD_LIBRARY_PATH"] = runtime["ld_library_path"]
    env["GST_PLUGIN_PATH"] = runtime["gst_plugin_path"]
    env["GST_REGISTRY"] = str(GST_REGISTRY_PATH)
    env["GST_DEBUG"] = env.get("GST_DEBUG", "2")
    env["GST_DEBUG_NO_COLOR"] = "1"
    if runtime["using_bundle"]:
        logger.warning("Using bundled GStreamer runtime; system GStreamer is unavailable.")
    else:
        logger.debug(f"Using system GStreamer runtime: {runtime['gst_plugin_path']}")
    return env


def _redact_url_for_log(url: str):
    if not url:
        return "<empty>"
    redacted = url.replace("/", "/")
    # Mask the stream key in a conservative way while keeping the host/path visible for diagnosis.
    if "/" in redacted:
        parts = redacted.split("/")
        if len(parts) > 3:
            last = parts[-1]
            if len(last) > 4:
                parts[-1] = "<redacted-key>"
                redacted = "/".join(parts)
    return redacted


def _gst_debug_summary():
    runtime = _gst_runtime_settings()
    env = _streaming_env()
    elements = [
        "pipewiresrc", "videoconvert", "videoscale", "videorate", "queue",
        "vaapih264enc", "x264enc", "h264parse", "h264timestamper", "flvmux",
        "rtmpsink", "rtmp2sink", "pulsesrc", "audioconvert", "audioresample",
        "audiorate", "avenc_aac", "fdkaacenc", "faac", "voaacenc", "aacparse"
    ]
    summary = {
        "runtime": "bundle" if runtime["using_bundle"] else "system",
        "plugin_path": env.get("GST_PLUGIN_PATH", ""),
        "ld_library_path": env.get("LD_LIBRARY_PATH", ""),
        "gst_debug": env.get("GST_DEBUG", "2"),
        "gst_registry": env.get("GST_REGISTRY", ""),
    }
    for el in elements:
        summary[el] = "present" if _gst_has_element(el) else "missing"
    return summary


def _log_gst_debug_summary(stream_id: str, url: str = ""):
    summary = _gst_debug_summary()
    logger.info(f"[stream:{stream_id}] GStreamer runtime summary: {json.dumps(summary, sort_keys=True)}")
    if url:
        logger.info(f"[stream:{stream_id}] RTMP target (redacted): {_redact_url_for_log(url)}")


def _reset_gst_registry_cache():
    """Remove cached GStreamer plugin registry and in-memory inspect cache so blacklisted plugins are re-scanned."""
    _GST_INSPECT_CACHE.clear()
    try:
        if GST_REGISTRY_PATH.exists():
            GST_REGISTRY_PATH.unlink()
    except Exception as e:
        logger.debug(f"Could not remove GST_REGISTRY cache {GST_REGISTRY_PATH}: {e}")


# ... existing _check_rtmpsink_available and other functions remain below

