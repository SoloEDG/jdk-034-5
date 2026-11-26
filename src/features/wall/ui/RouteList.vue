<script setup lang="ts">
import { ChevronRight, MapPinned } from 'lucide-vue-next';
import type { Route } from '../../../shared/types';
import { routes as builtinRoutes } from '../lib/routes';

withDefaults(defineProps<{ routes?: Route[]; active: string; reviewing: boolean }>(), {
  routes: () => builtinRoutes,
});
defineEmits<{ choose: [id: string] }>();
</script>

<template>
  <aside class="routes" aria-label="岩壁路线">
    <h2><MapPinned :size="17" /> 岩壁路线</h2>
    <button v-for="route in routes" :key="route.id" class="route-button" :class="{current: active === route.id}"
      :style="{'--route': route.color}" :aria-pressed="active === route.id && !reviewing" @click="$emit('choose', route.id)">
      <span class="grade">{{ route.grade }}</span>
      <span class="route-caption">
        <b>{{ route.name }}</b>
        <small>{{ route.certificate?.qualified ? '已穷尽证明 · ' : '' }}{{ route.tilt }}° · {{ route.holds.length }} 点 · 体力 {{ route.energy }}</small>
      </span>
      <ChevronRight :size="15" />
    </button>
  </aside>
</template>
