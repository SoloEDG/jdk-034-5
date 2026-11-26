import { computed, ref } from 'vue';
import type { Route } from '../../../shared/types';
import { routes as builtinRoutes } from '../lib/routes';

const STORAGE_KEY = 'crux-jdk034-generated-routes-v1';

function readGenerated(): Route[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as Route[];
    if (!Array.isArray(raw)) return [];
    return raw.filter(route => route
      && route.generator?.generated === true
      && route.certificate?.qualified === true
      && typeof route.id === 'string'
      && Array.isArray(route.holds)
      && route.start && typeof route.finish === 'string').slice(0, 6);
  } catch {
    return [];
  }
}

const generatedRoutes = ref<Route[]>(readGenerated());
const allRoutes = computed<Route[]>(() => [...generatedRoutes.value, ...builtinRoutes]);

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(generatedRoutes.value));
    return true;
  } catch {
    return false;
  }
}

export function useRouteRegistry() {
  function upsertGenerated(route: Route) {
    if (route.certificate?.qualified !== true) return false;
    const index = generatedRoutes.value.findIndex(item => item.id === route.id);
    if (index >= 0) generatedRoutes.value.splice(index, 1, route);
    else generatedRoutes.value.unshift(route);
    generatedRoutes.value = generatedRoutes.value.slice(0, 6);
    return persist();
  }

  function removeGenerated(id: string) {
    generatedRoutes.value = generatedRoutes.value.filter(route => route.id !== id);
    persist();
  }

  return { generatedRoutes, allRoutes, upsertGenerated, removeGenerated };
}
