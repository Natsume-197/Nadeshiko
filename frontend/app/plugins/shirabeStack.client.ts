import { userStore } from '~/stores/auth';
import { chosenProvider, setReaderProvider, setReaderStack } from '~/utils/wordLookup';

/**
 * Push the hydrated store fingerprint into the browser lookup cache: SSR `applySession` does not rerun merely
 * because Pinia state was restored. Watch for later auth/stack changes so lookup URLs stop reusing stale
 * dictionary responses. The reader's word-card dictionary travels the same way.
 */
export default defineNuxtPlugin(() => {
  const user = userStore();

  watchEffect(() => setReaderStack(user.shirabeStackFingerprint));
  watchEffect(() =>
    setReaderProvider(chosenProvider(user.preferences?.wordPopup?.dictionaryProvider, user.shirabeLinked)),
  );
});
