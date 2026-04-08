// ─── NEXT ACTIONS DEFINITIONS ────────────────────────────────────────────────

const NA_DEFINITIONS = {

  // ── No project input yet ──────────────────────────────────────────────────
  EMPTY: {
    label: '👋 Let\'s start:',
    groups: [
      {
        id: 'get_started',
        label: 'Get Started',
        subtext: null,
        buttons: [
          { id: 'upload_document',    name: 'Upload Document',      subtext: 'Meeting transcript, spec, or notes', tooltip: 'Upload a file to analyze',           tier: 'free', command: 'open_file_picker'  },
          { id: 'enter_project_input',name: 'Describe Your Project', subtext: 'Type your idea in a few sentences',  tooltip: 'Describe your project in the chat', tier: 'free', command: 'focus_chat_input'  }
        ]
      }
    ]
  },

  // ── Input exists — main CTA after any analyze / add / answer ─────────────
  // CONFIDENCE: from state.project_context.confidence — calculated by Chat Agent
  GENERATE: (params) => {
    const confidence = params.CONFIDENCE || '35';
    const label = parseInt(confidence) >= 75
        ? '✅ Ready to generate:'
        : parseInt(confidence) >= 50
            ? '🔍 Generate with assumptions:'
            : '⚡ Generate now:';

    return {
      label,
      groups: [
        {
          id: 'generate_structure',
          label: 'Generate Structure',
          subtext: `~${confidence}% confidence from available context`,
          buttons: [
            { id: 'only_modules',         name: 'Only Modules',       subtext: 'Step-by-step control',                     tooltip: 'Generates pages and modules only',                      tier: 'free', command: 'trigger_structure_modules'          },
            { id: 'modules_features',     name: 'Modules + Features', subtext: 'Balanced control',             tooltip: 'Generates pages, modules and features',                 tier: 'pro',  command: 'trigger_structure_modules_features' },
            { id: 'full_structure',       name: 'Full Structure',     subtext: 'One-click generation',    tooltip: 'Generates pages, modules, features and subfeatures',    tier: 'pro',  command: 'trigger_structure_full'             }
          ]
        }
      ]
    };
  },

  // ── Structure was inserted ────────────────────────────────────────────────
  STRUCTURE_INSERTED: {
    label: '💡 What\'s next:',
    groups: [
      {
        id: 'next_steps',
        label: 'Continue working',
        subtext: null,
        buttons: [
          { id: 'only_modules',     name: 'Regenerate Modules',     subtext: 'Regenerate with latest inputs',  tooltip: 'Regenerate modules from current input', tier: 'free', command: 'trigger_structure_modules'          },
          { id: 'modules_features', name: 'Modules + Features',     subtext: 'Regenerate with features',       tooltip: 'Regenerate with features',              tier: 'pro',  command: 'trigger_structure_modules_features' },
          { id: 'full_structure',   name: 'Full Structure',         subtext: 'Regenerate full depth',          tooltip: 'Regenerate full structure',             tier: 'pro',  command: 'trigger_structure_full'             }
        ]
      }
    ]
  },

  // ── Project conflict ──────────────────────────────────────────────────────
  CONFLICT: {
    label: '🔀 Choose project:',
    groups: [
      {
        id: 'project_conflict',
        label: 'Which project?',
        subtext: null,
        buttons: [
          { id: 'keep_existing_project', name: 'Keep existing project', subtext: 'Continue with current project',  tooltip: null, tier: 'free', command: 'keep_existing_project'  },
          { id: 'switch_to_new_project', name: 'Switch to new project', subtext: 'Replace with new description',   tooltip: null, tier: 'free', command: 'switch_to_new_project'  }
        ]
      }
    ]
  },

  // ── Generate intent without explicit type ─────────────────────────────────
  STRUCTURE_TYPE: (params) => ({
    label: '🎯 Choose generation depth:',
    groups: [
      {
        id: 'generate_structure',
        label: 'Generate Structure',
        subtext: `~${params.DIRECT || '35'}% confidence from available input`,
        buttons: [
          { id: 'only_modules',         name: 'Only Modules',       subtext: 'Pages + modules',                  tooltip: 'Generates pages and modules only',                   tier: 'free', command: 'trigger_structure_modules'          },
          { id: 'modules_features',     name: 'Modules + Features', subtext: 'Modules + feature lists',          tooltip: 'Generates pages, modules and features',              tier: 'pro',  command: 'trigger_structure_modules_features' },
          { id: 'full_structure',       name: 'Full Structure',     subtext: 'Modules + features + subfeatures', tooltip: 'Generates pages, modules, features and subfeatures', tier: 'pro',  command: 'trigger_structure_full'             }
        ]
      }
    ]
  }),

};

// ─── COMMAND → LLM TEXT MAP ───────────────────────────────────────────────────

const COMMAND_TO_TEXT = {
  trigger_structure_modules:          'Only modules',
  trigger_structure_modules_features: 'Modules + Features',
  trigger_structure_full:             'Full structure',
};

// ─── TAG RESOLVER ─────────────────────────────────────────────────────────────

/**
 * Resolves a NA tag string to a full next_actions object.
 * Examples:
 *   "[NA:EMPTY]"
 *   "[NA:GENERATE|CONFIDENCE:45]"
 *   "[NA:STRUCTURE_INSERTED]"
 *   "[NA:CONFLICT]"
 *   "[NA:STRUCTURE_TYPE|DIRECT:35]"
 */
function resolveNextActions(tag) {
  if (!tag || typeof tag !== 'string') return null;

  const inner   = tag.replace(/^\[|\]$/g, '');
  const parts   = inner.split('|');
  const tagName = parts[0].replace('NA:', '');

  const params = {};
  parts.slice(1).forEach(p => {
    const [k, v] = p.split(':');
    if (k && v !== undefined) params[k] = v;
  });

  const def = NA_DEFINITIONS[tagName];
  if (!def) {
    console.warn(`[NA] Unknown tag: ${tagName}`);
    return null;
  }

  return typeof def === 'function' ? def(params) : def;
}