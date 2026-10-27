<template>
  <div class="background-layer" aria-hidden="true">
    <div class="background-media">
      <img class="background-image" :src="imageSource" alt="" @error="imageError">
      <video ref="video" class="background-video" v-show="isVideo && !failed" :poster="preview" muted loop playsinline preload="metadata" @error="mediaError"></video>
    </div>
    <div class="background-shade"></div>
  </div>
</template>
<script>
const fallback = './assets/backgrounds/skylight-default.png';
export default {
    props: { media: Object, windowVisible: Boolean },
    data: () => ({ visible: !document.hidden, failed: false }),
    computed: {
        isVideo() { return this.media && !this.media.missing && this.media.kind === 'video'; },
        // Native visibility covers minimization when backgroundThrottling keeps document.hidden false.
        playing() { return this.windowVisible && this.visible; },
        preview() { return this.media && !this.media.missing && !this.failed ? this.media.preview : fallback; },
        imageSource() {
            if (!this.media || this.media.missing || this.failed) return fallback;
            // Static previews also cover animated WebP/APNG without leaving hidden decoders running.
            return this.media.kind !== 'video' && this.playing ? this.media.src : this.preview;
        }
    },
    watch: {
        media() { this.failed = false; this.setMedia(); },
        playing() { this.syncPlayback(); }
    },
    mounted() { document.addEventListener('visibilitychange', this.visibility); this.setMedia(); },
    beforeDestroy() { document.removeEventListener('visibilitychange', this.visibility); this.release(); },
    methods: {
        visibility() { this.visible = !document.hidden; },
        release() {
            const video = this.$refs.video;
            if (!video) return;
            video.pause();
            video.removeAttribute('src');
            video.load();
        },
        setMedia() {
            this.release();
            if (this.isVideo) {
                this.$refs.video.src = this.media.src;
                this.$refs.video.muted = true;
                this.syncPlayback();
            }
        },
        syncPlayback() {
            const video = this.$refs.video;
            if (!video || !this.isVideo || this.failed) return;
            if (this.playing) video.play().catch(() => { /* A later visibility change can retry autoplay. */ });
            else video.pause();
        },
        mediaError() { if (!this.isVideo || !this.$refs.video.getAttribute('src')) return; this.failed = true; this.release(); this.$emit('failed'); },
        imageError(event) { if (!this.failed) { this.failed = true; this.release(); event.target.src = fallback; this.$emit('failed'); } }
    }
};
</script>
