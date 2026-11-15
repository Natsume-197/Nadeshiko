/**
 * Set the theme during SSR so the first paint is already in the reader's theme. `system` stays unresolved; a CSS
 * media query reads the OS preference. A custom theme renders on its base palette, with its colours inline.
 */
export default defineNuxtPlugin(() => {
  const { attribute, header, style } = useThemePreference();

  useHead({
    htmlAttrs: {
      'data-theme': () => attribute.value,
      'data-header': () => header.value,
      style: () => style.value,
    },
  });
});
