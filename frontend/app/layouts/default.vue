<script setup lang="ts">
import { usePlayerBarHeight } from '~/composables/usePlayerAnchor';

const playerBarHeight = usePlayerBarHeight();
</script>

<template>
  <!-- Keep `dark` on <html> so it also covers teleported modals. -->
  <div class="flex bg-background flex-col min-h-screen overflow-x-clip">
    <!-- Let keyboard readers skip the header controls. -->
    <a href="#nd-main" class="nd-skip-link">{{ $t('common.skipToContent') }}</a>
    <AuthModalLoginSignUp />
    <LayoutImpersonationBanner />
    <LayoutHeader />
    <!-- Mount the teleport target before pages mount their floating buttons. -->
    <CommonFabDock />
    <!-- Shared gap under the navbar. Pages keep their own bottom padding. -->
    <main id="nd-main" class="flex-grow pt-3 pb-20">
      <slot />
    </main>
    <PlayerAudioPlayer />
    <CommonFeedbackWidget />
    <LayoutFooter />
    <!-- Room at the end for the player bar, fixed at the bottom edge while it is up, so the footer
         scrolls clear of it. One element's height, not a variable on <html>: a custom property on the
         root restyles the whole page each time the bar comes or goes. -->
    <div v-if="playerBarHeight > 0" aria-hidden="true" :style="{ height: `${playerBarHeight}px` }" />
  </div>
</template>
