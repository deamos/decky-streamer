FROM ghcr.io/steamdeckhomebrew/holo-base:latest

# Install GStreamer packages with RTMP support
# gst-plugins-bad provides libgstrtmp.so; on Arch the librtmp library comes from the rtmpdump package
RUN mkdir /pacman && pacman -Sydd --noconfirm --root /pacman --dbpath /var/lib/pacman \
    gstreamer-vaapi \
    gst-plugin-pipewire \
    gst-plugins-bad \
    gst-plugins-bad-libs \
    gst-plugins-good \
    gst-libav \
    rtmpdump

# Remove unnecessary plugins to reduce size
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
    libgstladspa.so \
    libgstdv.so || true

RUN pacman -Sydd --noconfirm --dbpath /var/lib/pacman python-pip

RUN pip3 install psutil --target=/psutil

ENTRYPOINT [ "/backend/entrypoint.sh" ]
