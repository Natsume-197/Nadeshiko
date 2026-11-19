import { userStore } from '~/stores/auth';
import { chosenProvider, setReaderProvider, setReaderStack } from '~/utils/wordLookup';

/**
 * Push the hydrated store fingerprint into the browser lookup cache: SSR `applySession` does not rerun merely
 * because Pinia state was restored. Watch for later auth/stack changes so lookup URLs stop reusing stale
 * dictionary responses. The reader's word-card dictionary travels the same way.
 */
export default defineNuxtPlugin(() => {
  const user = userStore();
  const runtimeConfig = useRuntimeConfig();

  watchEffect(() => {
    const chosen = chosenProvider(user.preferences?.wordPopup?.dictionaryProvider, user.shirabeLinked);
    setReaderProvider(chosen);

    const effective = chosen ?? (runtimeConfig.public.dictionaryProvider === 'nadeshiko' ? 'nadeshiko' : 'shirabe');
    setReaderStack(effective === 'shirabe' ? user.shirabeStackFingerprint : user.customDictionariesFingerprint);
  });
});
