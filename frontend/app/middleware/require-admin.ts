/** Send signed-in non-admins to their settings; run after `auth` so anonymous readers go home instead. */
export default defineNuxtRouteMiddleware(() => {
  if (!userStore().isAdmin) {
    return navigateTo(useLocalePath()('/user/settings'), { replace: true });
  }
});
