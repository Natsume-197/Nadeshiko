<script setup lang="ts">
import {
  REQUEST_CATEGORY_ICONS,
  type RequestCategory,
  categoryPlaceholderTone,
  usesAmbientCover,
} from '~/utils/contentRequests';

withDefaults(
  defineProps<{
    category: RequestCategory;
    coverUrl: string | null;
    iconSize?: number | string;
    hoverZoom?: boolean;
    lazy?: boolean;
    compact?: boolean;
  }>(),
  {
    iconSize: 24,
    hoverZoom: false,
    lazy: true,
    compact: false,
  },
);
</script>

<template>
  <div class="relative shrink-0 overflow-hidden bg-background ring-1 ring-white/10">
    <template v-if="coverUrl">
      <template v-if="usesAmbientCover(category)">
        <img
          :src="coverUrl"
          alt=""
          :loading="lazy ? 'lazy' : undefined"
          referrerpolicy="no-referrer"
          aria-hidden="true"
          class="absolute inset-0 h-full w-full scale-125 object-cover brightness-75"
          :class="compact ? 'blur-sm' : 'blur-md'"
        >
        <div class="relative flex h-full w-full items-center justify-center" :class="compact ? 'p-0.5' : 'p-1'">
          <img
            :src="coverUrl"
            alt=""
            :loading="lazy ? 'lazy' : undefined"
            referrerpolicy="no-referrer"
            class="max-h-full max-w-full object-contain"
            :class="[
              compact ? 'rounded-[2px]' : 'rounded-[4px] shadow-md',
              hoverZoom ? 'transition-transform duration-300 group-hover:scale-[1.04]' : '',
            ]"
          >
        </div>
      </template>
      <img
        v-else
        :src="coverUrl"
        alt=""
        :loading="lazy ? 'lazy' : undefined"
        referrerpolicy="no-referrer"
        class="h-full w-full object-cover"
        :class="hoverZoom ? 'transition-transform duration-300 group-hover:scale-[1.04]' : ''"
      >
    </template>
    <div
      v-else
      class="flex h-full w-full items-center justify-center bg-gradient-to-br"
      :class="categoryPlaceholderTone(category)"
    >
      <UiBaseIcon
        :path="REQUEST_CATEGORY_ICONS[category]"
        :w="compact ? 'w-4' : undefined"
        :h="compact ? 'h-4' : undefined"
        :size="iconSize"
      />
    </div>
  </div>
</template>
