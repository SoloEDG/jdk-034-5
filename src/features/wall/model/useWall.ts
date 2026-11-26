import { computed, ref } from 'vue';
import { useRouteRegistry } from './useRouteRegistry';

export function useWall() {
  const { allRoutes } = useRouteRegistry();
  const routeId = ref(allRoutes.value[0].id);
  const route = computed(() => allRoutes.value.find(item => item.id === routeId.value) ?? allRoutes.value[0]);
  function choose(id: string) {
    if (allRoutes.value.some(item => item.id === id)) routeId.value = id;
  }

  return { routeId, route, routes: allRoutes, choose };
}
