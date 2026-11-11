import importStyle from './import-style.mjs';
import noBareErrorThrow from './no-bare-error-throw.mjs';
import noDeepFeatureImport from './no-deep-feature-import.mjs';
import noDirectSessionRead from './no-direct-session-read.mjs';
import noEffectFetch from './no-effect-fetch.mjs';
import noJournalComments from './no-journal-comments.mjs';
import noMachineStatusWrite from './no-machine-status-write.mjs';
import noRawColorLiterals from './no-raw-color-literals.mjs';
import noRawEnvRead from './no-raw-env-read.mjs';
import noRawIntlFormat from './no-raw-intl-format.mjs';
import noSharedFeatureImport from './no-shared-feature-import.mjs';
import noSilentCatch from './no-silent-catch.mjs';
import noStrayConsole from './no-stray-console.mjs';
import noUpwardFeatureImport from './no-upward-feature-import.mjs';
import requireActionBoundary from './require-action-boundary.mjs';
import requireFormPrimitive from './require-form-primitive.mjs';
import requireRequestContext from './require-request-context.mjs';
import suppressionRequiresReason from './suppression-requires-reason.mjs';

const plugin = {
  meta: { name: 'just-a-wrapper', version: '0.0.0' },
  rules: {
    'import-style': importStyle,
    'no-machine-status-write': noMachineStatusWrite,
    'no-bare-error-throw': noBareErrorThrow,
    'no-deep-feature-import': noDeepFeatureImport,
    'no-direct-session-read': noDirectSessionRead,
    'no-effect-fetch': noEffectFetch,
    'no-journal-comments': noJournalComments,
    'no-raw-color-literals': noRawColorLiterals,
    'no-raw-env-read': noRawEnvRead,
    'no-raw-intl-format': noRawIntlFormat,
    'no-shared-feature-import': noSharedFeatureImport,
    'no-silent-catch': noSilentCatch,
    'no-stray-console': noStrayConsole,
    'no-upward-feature-import': noUpwardFeatureImport,
    'require-action-boundary': requireActionBoundary,
    'require-form-primitive': requireFormPrimitive,
    'require-request-context': requireRequestContext,
    'suppression-requires-reason': suppressionRequiresReason,
  },
};

export default plugin;
