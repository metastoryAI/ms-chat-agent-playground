// ─── NEXT ACTIONS DEFINITIONS ────────────────────────────────────────────────

const NA_DEFINITIONS = {

  EMPTY: {
    groups: [
      {
        id: 'get_started',
        buttons: [
          { id: 'upload_document',     name: 'Upload Document',       subtext: 'Meeting transcript, spec, or notes', command: 'open_file_picker' },
          { id: 'enter_project_input', name: 'Describe Project', subtext: 'Type the idea in a few sentences',  command: 'focus_chat_input' }
        ]
      }
    ]
  },

  // Emitted by CLARIFY agent when intent is unclear (variant_key: "intent_unclear").
  // Four buckets the user picks between to disambiguate; each focuses the input
  // so the next message is interpreted under the chosen lane.
  INTENT_PICKER: {
    groups: [
      {
        id: "pick_intent",
        buttons: [
          {
            id: "intent_analyze",
            name: "Analyze",
            subtext: "Analyze documentation and project context for later generation of modules, features, pages, and workflows",
            command: "intent_picker_analyze"
          },
          {
            id: "intent_answer",
            name: "Ask Project Questions",
            subtext: "Ask questions about the project, requirements, workflows, or structure",
            command: "intent_picker_answer"
          }
        ]
      }
    ]
  },

  GENERATE: (params) => {
    const confidence = params.CONFIDENCE || '35';
    const confNum = parseInt(confidence, 10) || 0;
    const enrichMaxed = confNum >= 90;
    return {
      groups: [
        {
          id: 'generate_builder',
          buttons: [
            { id: 'only_modules',     name: 'Generate Modules',       subtext: `Generate Modules first, features later · ~${confidence}% confidence`, command: 'trigger_builder_modules'          },
            { id: 'modules_features', name: 'Generate Modules with Features', subtext: `Full generation in one step · ~${confidence}% confidence`,   command: 'trigger_builder_modules_features' },
          ]
        },
        { separator: true },
        { contextRow: true },
        {
          id: 'enrich_context',
          buttons: [
            {
              id:       'enrich_context',
              name:     'Enrich Context',
              subtext:  enrichMaxed ? 'Over 90% reached — no further enrichment needed' : 'Expand scope · up to ~90% confidence',
              command:  'trigger_enrich_context',
              disabled: enrichMaxed,
            }
          ]
        },
      ]
    };
  },

  REFINE: (params) => {
    const genType  = params.GENTYPE === 'modules_features' ? 'modules_features' : 'modules';
    const hasNew   = params.NEW_INPUT === '1';
    const groups = [];

    // Regenerate appears at the top only if new input has arrived since insert.
    if (hasNew) {
      const regenLabel = genType === 'modules_features'
          ? 'Regenerate Modules with Features'
          : 'Regenerate Modules';
      groups.push({
        id: 'regenerate',
        buttons: [
          { id: 'regenerate', name: 'Regenerate', subtext: 'Update structure with new context (diff)', command: 'trigger_builder_regenerate' }
        ],
      });
    }

    // Features action (only when modules-only was inserted — otherwise features already exist).
    if (genType === 'modules') {
      groups.push({
        id: 'features_action',
        buttons: [
          { id: 'generate_features', name: 'Generate Features', subtext: 'Add features to modules', command: 'trigger_builder_modules_features' }
        ],
      });
    }

    // Artifact generation group (all disabled for now — "coming soon")
    const artifactBtns = [];
    if (genType === 'modules_features') {
      artifactBtns.push({ id: 'generate_features',     name: 'Generate Features',     subtext: 'Add features to modules',          command: 'coming_soon', disabled: true });
      artifactBtns.push({ id: 'generate_subfeatures',  name: 'Generate Subfeatures',  subtext: 'Add subfeatures to features',      command: 'coming_soon', disabled: true });
    }
    artifactBtns.push({ id: 'generate_descriptions',  name: 'Generate Descriptions', subtext: 'Generate long descriptions',        command: 'coming_soon', disabled: true });
    artifactBtns.push({ id: 'generate_user_stories',  name: 'Generate User Stories', subtext: 'Generate user stories with AC',     command: 'coming_soon', disabled: true });
    artifactBtns.push({ id: 'generate_estimation',    name: 'Generate Estimation',   subtext: 'Generate effort estimation',        command: 'coming_soon', disabled: true });

    groups.push({
      id: 'artifacts',
      title: 'For Modules/Features',
      buttons: artifactBtns,
    });

    groups.push({ separator: true });
    groups.push({ contextRow: true });
    groups.push({
      id: 'enrich',
      buttons: [
        { id: 'enrich_context', name: 'Enrich Context', subtext: 'Expand scope with discovery questions', command: 'trigger_enrich_context' }
      ],
    });

    return { groups };
  },

  CONFLICT: {
    groups: [
      {
        id: 'project_conflict',
        buttons: [
          { id: 'proceed_with_new_input', name: 'Proceed',  subtext: 'Merge new input with current project', command: 'proceed_with_new_input' },
          { id: 'discard_new_input',      name: 'Discard',  subtext: 'Drop new input, keep current',         command: 'discard_new_input' }
        ]
      }
    ]
  },

  BUILDER_CARD: (params) => {
    const assumptionCount = parseInt(params.ASSUMPTIONS || '0');
    const genType = params.GENTYPE || 'modules'; // 'modules' | 'modules_features'
    const confNum = parseInt(params.CONFIDENCE || '0', 10) || 0;
    const enrichMaxed = confNum >= 90;
    const isDiff = params.DIFF === '1';
    const insertSubtext = isDiff
        ? 'Merge changes into project'
        : (assumptionCount > 0 ? 'Insert with open points into project' : 'Insert into project');
    const discardSubtext = isDiff
        ? 'Discard changes and keep current tree'
        : 'Discard and go back to chat';

    // Group 1 — Structure actions
    const structureBtns = [
      isDiff
        ? { id: 'insert_merge', name: 'Insert & Merge', subtext: insertSubtext, command: 'builder_insert' }
        : { id: 'insert',       name: 'Insert',         subtext: insertSubtext, command: 'builder_insert' },
    ];
    // Generate Features only makes sense when not in diff-mode and modules-only was generated.
    if (!isDiff && genType === 'modules') {
      structureBtns.push({ id: 'generate_features', name: 'Generate Features', subtext: 'Generate features for current modules', command: 'builder_generate_features' });
    }
    if (assumptionCount > 0) {
      structureBtns.push({ id: 'resolve_open_points', name: 'Resolve Open Points', subtext: `Resolve ${assumptionCount} open assumptions`, command: 'builder_resolve' });
    }

    return {
      groups: [
        { id: 'structure', buttons: structureBtns },
        { id: 'separator', separator: true },
        { contextRow: true },
        { id: 'enrich', buttons: [
          {
            id:       'enrich_context',
            name:     'Enrich Context',
            subtext:  enrichMaxed ? 'Over 90% reached — no further enrichment needed' : 'Expand scope · up to ~90% confidence',
            command:  'builder_enrich',
            disabled: enrichMaxed,
          },
        ]},
        { id: 'separator', separator: true },
        { id: 'exit',   buttons: [{ id: 'discard', name: 'Discard', subtext: discardSubtext, command: 'builder_discard' }] },
      ]
    };
  },

  ENRICH_DEPTH: {
    groups: [
      {
        id: 'depth_options',
        title: 'Enrich Context',
        buttons: [
          { id: 'quick',  name: 'Quick',  subtext: '3-4 Questions · +15% confidence',   command: 'trigger_enrich_depth_quick'  },
          { id: 'medium', name: 'Medium', subtext: '6-8 Questions · +25% confidence',   command: 'trigger_enrich_depth_medium' },
          { id: 'deep',   name: 'Deep',   subtext: '10-14 Questions · +40% confidence', command: 'trigger_enrich_depth_deep'   },
        ]
      },
      { separator: true },
      {
        id: 'back',
        buttons: [
          { id: 'back', name: 'Back', subtext: 'Back to menu', command: 'trigger_enrich_depth_back' }
        ]
      },
    ]
  },

  GENERATE_TYPE: (params) => {
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
  trigger_builder_modules:          'Generate Modules',
  trigger_builder_modules_features: 'Generate Modules & Features',
  builder_insert:                   null,
  builder_resolve:                  null,
  builder_enrich:                   null,
  builder_discard:                  null,
  builder_generate_features:        null,
};

// ─── TAG RESOLVER ─────────────────────────────────────────────────────────────

function resolveNextActions(tag) {
  // Per the current prompt contract, `next_actions` is always an array of tag
  // strings (typically length 1). Accept either form so legacy single-string
  // call sites (e.g. resolveNextActions('[NA:EMPTY]')) keep working.
  if (Array.isArray(tag)) {
    if (tag.length === 0) return null;
    if (tag.length > 1) {
      console.warn(`[NA] Multiple tags received, only the first is rendered:`, tag);
    }
    tag = tag[0];
  }
  if (!tag || typeof tag !== 'string') return null;

  const inner   = tag.replace(/^\[|]$/g, '');
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