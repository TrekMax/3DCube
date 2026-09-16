import { computed, inject, provide, type Ref, type InjectionKey } from 'vue';
import { COLORS as DEFAULT_COLORS } from './cube';
import type { PaletteConfig } from './palette';
function createContext(profile: Ref<PaletteConfig>) {
  return {
    profile,
    colors: computed(() => ({ ...profile.value.colors, '?': DEFAULT_COLORS['?'] })),
    names: computed(() => profile.value.names),
  };
}
const key: InjectionKey<ReturnType<typeof createContext>> = Symbol('cube-color-palette');
export function providePalette(profile: Ref<PaletteConfig>) {
  const context = createContext(profile);
  provide(key, context);
  return context;
}
export function usePalette() {
  const context = inject(key);
  if (!context) throw new Error('Cube color palette is not provided.');
  return context;
}
