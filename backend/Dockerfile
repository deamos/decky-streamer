FROM ghcr.io/steamdeckhomebrew/holo-base:latest

# Install GStreamer packages with RTMP and AAC support
# gst-plugins-bad provides libgstrtmp.so, libgstfdkaac.so, and libgstfaac.so.
# nettle is bundled alongside rtmpdump because librtmp.so.1 links against libhogweed.so.6 / libnettle.so.8,
# whereas newer SteamOS releases upgrade system nettle to 4.x (libhogweed.so.7 / libnettle.so.9).
# libfdk-aac and faac are bundled because newer SteamOS releases upgrade FFmpeg (breaking gst-libav's avenc_aac),
# while libfdk-aac.so.2 and libfaac.so.0 only depend on libc/libm.
RUN mkdir /pacman && pacman -Sydd --noconfirm --root /pacman --dbpath /var/lib/pacman \
    gstreamer-vaapi \
    gst-plugin-pipewire \
    gst-plugins-bad \
    gst-plugins-bad-libs \
    gst-plugins-good \
    gst-libav \
    rtmpdump \
    nettle \
    libfdk-aac \
    faac

# Remove unnecessary plugins to reduce size
# NOTE: libgstladspa.so is kept — it is required for loading LADSPA plugins (rnnoise)
RUN cd /pacman/usr/lib/gstreamer-1.0/ && rm -f \
    libgstneonhttpsrc.so \
    libgstfaad.so \
    libgstcacasink.so \
    libgstaasink.so \
    libgstspandsp.so \
    libgstgme.so \
    libgstteletext.so \
    libgstshout2.so \
    libgstchromaprint.so \
    libgstkate.so \
    libgstwildmidi.so \
    libgstmusepack.so \
    libgstmplex.so \
    libgsttimecode.so \
    libgstavtp.so \
    libgstwebrtc.so \
    libgsttwolame.so \
    libgstmpeg2enc.so \
    libgstopenmpt.so \
    libgstdtsdec.so \
    libgstzbar.so \
    libgstresindvd.so \
    libgstdc1394.so \
    libgstsoundtouch.so \
    libgstmicrodns.so \
    libgstmpg123.so \
    libgstopenexr.so \
    libgstfluidsynthmidi.so \
    libgstsvthevcenc.so \
    libgstwavpack.so \
    libgstde265.so \
    libgstsrtp.so \
    libgstdv.so || true

# Download rnnoise noise suppression LADSPA plugin (GPL-3.0)
# https://github.com/werman/noise-suppression-for-voice
RUN pacman -Sydd --noconfirm --dbpath /var/lib/pacman unzip && \
    mkdir -p /rnnoise && \
    curl -L "https://github.com/werman/noise-suppression-for-voice/releases/download/v1.03/linux-rnnoise.zip" -o /tmp/linux-rnnoise.zip && \
    unzip -j /tmp/linux-rnnoise.zip 'linux-rnnoise/ladspa/librnnoise_ladspa.so' -d /rnnoise && \
    rm /tmp/linux-rnnoise.zip

RUN pacman -Sydd --noconfirm --dbpath /var/lib/pacman python-pip

RUN pip3 install psutil --target=/psutil

ENTRYPOINT [ "/backend/entrypoint.sh" ]
