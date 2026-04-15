// ─── NEXT ACTIONS DEFINITIONS ────────────────────────────────────────────────

const NA_DEFINITIONS = {

  EMPTY: {
    groups: [
      {
        id: 'get_started',
        buttons: [
          { id: 'upload_document',     name: 'Upload Document',       subtext: 'Meeting transcript, spec, or notes', command: 'open_file_picker' },
          { id: 'enter_project_input', name: 'Describe Your Project', subtext: 'Type your idea in a few sentences',  command: 'focus_chat_input' }
        ]
      }
    ]
  },

  GENERATE: (params) => {
    const confidence = params.CONFIDENCE || '35';
    return {
      groups: [
        {
          id: 'generate_builder',
          buttons: [
            { id: 'only_modules',     name: 'Only Modules',       subtext: `Modules first, features later · ~${confidence}% confidence`, command: 'trigger_builder_modules'          },
            { id: 'modules_features', name: 'Modules + Features', subtext: `Full generation in one step · ~${confidence}% confidence`,   command: 'trigger_builder_modules_features' },
          ]
        },
        {
          id: 'enrich_context',
          buttons: [
            { id: 'enrich_context', name: 'Enrich Context', subtext: 'Expand scope · up to ~90% confidence', command: 'trigger_enrich_context' }
          ]
        },
      ]
    };
  },

  BUILDER_INSERTED: {
    groups: [
      {
        id: 'next_steps',
        buttons: [
          { id: 'only_modules',     name: 'Regenerate Modules', subtext: 'Regenerate with latest inputs', command: 'trigger_builder_modules'          },
          { id: 'modules_features', name: 'Modules + Features', subtext: 'Regenerate with features',      command: 'trigger_builder_modules_features' },
        ]
      }
    ]
  },

  CONFLICT: {
    groups: [
      {
        id: 'project_conflict',
        buttons: [
          { id: 'keep_existing_project', name: 'Keep existing project', subtext: 'Continue with current project', command: 'keep_existing_project' },
          { id: 'switch_to_new_project', name: 'Switch to new project', subtext: 'Replace with new description',  command: 'switch_to_new_project' }
        ]
      }
    ]
  },

  BUILDER_CARD: (params) => {
    const assumptionCount = parseInt(params.ASSUMPTIONS || '0');
    const workBtns = [];
    if (assumptionCount > 0) {
      workBtns.push({ id: 'resolve_open_points', name: 'Resolve Open Points', subtext: `Resolve ${assumptionCount} open assumptions`, command: 'builder_resolve' });
    }
    workBtns.push(
        { id: 'enrich_context', name: 'Enrich Context', subtext: 'Expand scope · up to ~90% confidence', command: 'builder_enrich' },
    );

    const insertSubtext = assumptionCount > 0
        ? 'Insert with open points into project'
        : 'Insert into project';

    return {
      groups: [
        { id: 'accept', buttons: [{ id: 'insert',  name: 'Insert',          subtext: insertSubtext,                command: 'builder_insert'  }] },
        { id: 'separator', separator: true },
        { id: 'refine', buttons: workBtns },
        { id: 'exit',   buttons: [{ id: 'discard', name: 'Discard & Close', subtext: 'Discard and go back to chat', command: 'builder_discard' }] },
      ]
    };
  },

  BUILDER_TYPE: (params) => {
    const confidence = params.DIRECT || '35';
    return {
      groups: [
        {
          id: 'generate_builder',
          buttons: [
            { id: 'only_modules',     name: 'Only Modules',       subtext: `Generate modules first, features later · ~${confidence}% confidence`, command: 'trigger_builder_modules'          },
            { id: 'modules_features', name: 'Modules + Features', subtext: `Full generation in one step · ~${confidence}% confidence`,   command: 'trigger_builder_modules_features' },
          ]
        },
      ]
    };
  },

};

// ─── COMMAND → LLM TEXT MAP ───────────────────────────────────────────────────

const COMMAND_TO_TEXT = {
  trigger_builder_modules:          'Only modules',
  trigger_builder_modules_features: 'Modules + Features',
  builder_insert:                   null,
  builder_resolve:                  null,
  builder_enrich:                   null,
  builder_discard:                  null,
};

// ─── TAG RESOLVER ─────────────────────────────────────────────────────────────

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