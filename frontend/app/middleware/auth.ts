/** Send anonymous readers to the home page; opted into by account and admin pages. */
export default defineNuxtRouteMiddleware(() => {
  if (!userStore().isLoggedIn) {
    return navigateTo(useLocalePath()('/'), { replace: true });
  }
});
