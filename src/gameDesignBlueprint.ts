// @ts-nocheck
/**
 * Deterministic game-design fallback shared with the public Glitch prompt page.
 * The hosted OpenAI service remains preferred; this keeps MCP generation useful
 * while the public backend route is unavailable or temporarily fails.
 */
export const GAME_DESIGN_PLAY_MODES = [
    { value: 'single-player', label: 'Single-player' },
    { value: 'cooperative', label: 'Cooperative' },
    { value: 'competitive multiplayer', label: 'Competitive multiplayer' },
    { value: 'asynchronous multiplayer', label: 'Asynchronous multiplayer' },
];

export const GAME_DESIGN_SESSION_LENGTHS = [
    { value: '5–10 minute', label: '5–10 minutes' },
    { value: '15–30 minute', label: '15–30 minutes' },
    { value: '30–60 minute', label: '30–60 minutes' },
    { value: 'open-ended', label: 'Open-ended' },
];

export const INITIAL_GAME_DESIGN_INPUTS = {
    gameName: '',
    genres: [],
    genre: 'action',
    playMode: 'single-player',
    sessionLength: '15–30 minute',
    playerFantasy: '',
    setting: '',
    primaryGoal: '',
    mainPressure: '',
    signatureTwist: '',
    progression: '',
    preferredActivities: '',
};

const GENRE_PROFILES = {
    action: {
        verbs: ['move', 'engage', 'evade', 'recover'],
        interaction: 'Keep controls responsive, threats readable, and recovery windows clear enough for deliberate mastery.',
        escalation: 'Increase threat combinations, speed, density, and spatial pressure instead of only adding enemy health.',
        feedback: 'Use immediate animation, sound, hit, danger, and recovery feedback so the player understands every exchange.',
    },
    adventure: {
        verbs: ['explore', 'observe', 'interact', 'solve'],
        interaction: 'Reward curiosity with information, discoveries, characters, routes, and meaningful changes to the world.',
        escalation: 'Deepen uncertainty, consequences, and environmental complexity as the player learns more about the world.',
        feedback: 'Make discoveries and story consequences visible through world changes, character reactions, and new possibilities.',
    },
    rpg: {
        verbs: ['explore', 'choose', 'overcome', 'grow'],
        interaction: 'Connect exploration, combat, dialogue, and character building so each activity supports the same role-playing fantasy.',
        escalation: 'Introduce harder choices, stronger opposition, and build-defining trade-offs rather than relying only on larger numbers.',
        feedback: 'Show growth through new capabilities, changed relationships, visible equipment, and access to previously impossible options.',
    },
    strategy: {
        verbs: ['scout', 'plan', 'deploy', 'adapt'],
        interaction: 'Give the player enough information to form a plan while preserving uncertainty that requires adaptation.',
        escalation: 'Add competing objectives, constrained resources, incomplete information, and opponents that punish predictable plans.',
        feedback: 'Clearly communicate state, intent, range, cost, risk, and the consequences of each strategic commitment.',
    },
    simulation: {
        verbs: ['observe', 'manage', 'optimize', 'expand'],
        interaction: 'Build understandable systems whose interactions create surprising but explainable outcomes.',
        escalation: 'Increase scale, interdependence, volatility, and competing demands while preserving player agency.',
        feedback: 'Use trends, forecasts, alerts, and visible system behavior so players can connect cause and effect.',
    },
    puzzle: {
        verbs: ['inspect', 'manipulate', 'test', 'solve'],
        interaction: 'Teach rules through play, allow safe experimentation, and make each solution feel logically earned.',
        escalation: 'Combine previously learned rules in new arrangements instead of hiding answers behind arbitrary information.',
        feedback: 'Make state changes, invalid assumptions, partial progress, and successful deductions immediately legible.',
    },
    survival: {
        verbs: ['explore', 'gather', 'prepare', 'endure'],
        interaction: 'Turn time, safety, inventory, condition, and location into connected survival decisions.',
        escalation: 'Increase environmental danger, scarcity, distance, and irreversible commitments while leaving multiple responses viable.',
        feedback: 'Signal worsening conditions early enough for planning, then make the consequences of poor preparation tangible.',
    },
    platformer: {
        verbs: ['move', 'jump', 'avoid', 'reach'],
        interaction: 'Prioritize consistent movement, readable spaces, forgiving input buffering, and challenges built around mastery.',
        escalation: 'Combine movement skills, timing demands, route choices, and environmental hazards in progressively richer sequences.',
        feedback: 'Use strong anticipation, landing, failure, checkpoint, and collectible feedback to reinforce movement rhythm.',
    },
    racing: {
        verbs: ['steer', 'accelerate', 'overtake', 'optimize'],
        interaction: 'Make speed, handling, route choice, and risk management readable enough for players to improve each attempt.',
        escalation: 'Add tighter routes, stronger rivals, changing conditions, and harder trade-offs between speed and control.',
        feedback: 'Communicate traction, speed, position, split times, danger, and route quality without pulling attention from driving.',
    },
    sports: {
        verbs: ['position', 'execute', 'defend', 'score'],
        interaction: 'Create readable space, timing, team roles, possession, and counterplay around the sport’s central contest.',
        escalation: 'Raise tactical pressure through opponent adaptation, fatigue, score state, and increasingly costly mistakes.',
        feedback: 'Make timing, contact, possession, legal actions, scoring opportunities, and team intent instantly understandable.',
    },
    cozy: {
        verbs: ['explore', 'gather', 'create', 'connect'],
        interaction: 'Support self-directed goals, gentle discovery, expression, collection, and relationships without unnecessary punishment.',
        escalation: 'Broaden possibilities, responsibilities, and personal projects while allowing the player to choose their pace.',
        feedback: 'Celebrate small improvements through animation, sound, character reactions, collection growth, and environmental change.',
    },
    horror: {
        verbs: ['investigate', 'conserve', 'hide', 'escape'],
        interaction: 'Balance vulnerability, uncertainty, limited information, and meaningful choices about when to confront danger.',
        escalation: 'Reduce safe assumptions, increase pursuit and resource pressure, and force movement into less understood spaces.',
        feedback: 'Use restrained audio, lighting, environmental clues, and threat behavior to build tension without confusing the player.',
    },
    card: {
        verbs: ['draw', 'evaluate', 'play', 'adapt'],
        interaction: 'Make card value contextual through synergies, timing, resource costs, deck identity, and opponent intent.',
        escalation: 'Introduce stronger combinations, narrower margins, disruptive opponents, and choices that reshape future draws.',
        feedback: 'Show costs, targets, order of operations, triggered effects, and predicted outcomes before the player commits.',
    },
    sandbox: {
        verbs: ['explore', 'collect', 'build', 'experiment'],
        interaction: 'Provide interoperable tools and rules that support player-authored goals, experimentation, and surprising outcomes.',
        escalation: 'Expand the scale, complexity, and consequences of creation instead of imposing one mandatory path.',
        feedback: 'Make tool behavior, dependencies, limits, and world reactions visible so experimentation teaches the system.',
    },
};

const GENRE_PROFILE_LABELS = {
    action: 'Action',
    adventure: 'Adventure',
    rpg: 'RPG',
    strategy: 'Strategy',
    simulation: 'Simulation',
    puzzle: 'Puzzle',
    survival: 'Survival',
    platformer: 'Platformer',
    racing: 'Racing',
    sports: 'Sports',
    cozy: 'Cozy',
    horror: 'Horror',
    card: 'Card or deckbuilder',
    sandbox: 'Sandbox',
};

function cleanText(value, fallback = '') {
    return String(value || fallback).trim().replace(/\s+/g, ' ');
}

function lowerFirst(value) {
    const text = cleanText(value);
    return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

function upperFirst(value) {
    const text = cleanText(value);
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

function withoutTerminalPunctuation(value) {
    return cleanText(value).replace(/[.!?]+$/, '');
}

function withPeriod(value) {
    const text = cleanText(value);
    return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}

function listWithAnd(items) {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function readableGenreName(value) {
    return cleanText(value)
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getGameDesignGenreProfile(value) {
    const genre = readableGenreName(value).toLowerCase();

    if (/\b(rpg|role playing|role-playing|mmorpg)\b/.test(genre)) return 'rpg';
    if (/\b(strategy|strategic|tactics|tactical|rts|turn based|turn-based|4x)\b/.test(genre)) return 'strategy';
    if (/\b(simulation|simulator|sim|management|tycoon)\b/.test(genre)) return 'simulation';
    if (/\b(platform|platformer|metroidvania)\b/.test(genre)) return 'platformer';
    if (/\b(card|deck|deckbuilder|board game)\b/.test(genre)) return 'card';
    if (/\b(sandbox|open world|open-world|building)\b/.test(genre)) return 'sandbox';
    if (/\b(cozy|wholesome|relaxing|casual)\b/.test(genre)) return 'cozy';
    if (/\b(horror|scary|terror)\b/.test(genre)) return 'horror';
    if (/\b(survival|survive)\b/.test(genre)) return 'survival';
    if (/\b(puzzle|logic)\b/.test(genre)) return 'puzzle';
    if (/\b(racing|driving|motorsport)\b/.test(genre)) return 'racing';
    if (/\b(sports|sport)\b/.test(genre)) return 'sports';
    if (/\b(adventure|exploration|narrative)\b/.test(genre)) return 'adventure';
    return 'action';
}

function normalizeGenreNames(inputs) {
    const suppliedGenres = Array.isArray(inputs.genres)
        ? inputs.genres.map(readableGenreName).filter(Boolean)
        : [];

    if (suppliedGenres.length > 0) return unique(suppliedGenres);

    const profile = GENRE_PROFILES[inputs.genre] ? inputs.genre : getGameDesignGenreProfile(inputs.genre);
    return [GENRE_PROFILE_LABELS[profile] || readableGenreName(inputs.genre) || 'Action'];
}

function interleaveGenreVerbs(profiles) {
    return Array.from({ length: 4 }, (_, verbIndex) => (
        profiles.map((profile) => profile.verbs[verbIndex])
    )).flat();
}

function parseActivities(value) {
    return String(value || '')
        .split(/[,;\n]+|\s+\/\s+/)
        .map((activity) => activity.trim().replace(/^to\s+/i, '').replace(/[.!?]+$/, ''))
        .filter(Boolean);
}

function unique(items) {
    return items.filter((item, index) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function optionLabel(options, value, fallback) {
    return options.find((option) => option.value === value)?.label || fallback;
}

export function buildGameDesignBlueprint(rawInputs) {
    const inputs = { ...INITIAL_GAME_DESIGN_INPUTS, ...rawInputs };
    const genreNames = normalizeGenreNames(inputs);
    const profileKeys = unique(genreNames.map(getGameDesignGenreProfile));
    const profiles = profileKeys.map((profileKey) => GENRE_PROFILES[profileKey] || GENRE_PROFILES.action);
    const gameName = cleanText(inputs.gameName, 'Untitled game');
    const genreLabel = listWithAnd(genreNames.map((genreName) => genreName.toLowerCase()));
    const playModeLabel = optionLabel(GAME_DESIGN_PLAY_MODES, inputs.playMode, 'Single-player');
    const playerFantasy = withoutTerminalPunctuation(inputs.playerFantasy || 'a capable character pursuing a meaningful objective');
    const setting = withoutTerminalPunctuation(inputs.setting || 'a distinctive world');
    const primaryGoal = withoutTerminalPunctuation(inputs.primaryGoal || 'complete the central objective');
    const mainPressure = withoutTerminalPunctuation(inputs.mainPressure || 'the situation becomes harder over time');
    const signatureTwist = withoutTerminalPunctuation(inputs.signatureTwist || 'the familiar rules change in a way that creates a new decision');
    const progression = withoutTerminalPunctuation(inputs.progression || 'earn new options that deepen the same core decisions');
    const customActivities = parseActivities(inputs.preferredActivities);
    const coreVerbs = unique([...customActivities, ...interleaveGenreVerbs(profiles)]).slice(0, 4).map(upperFirst);
    const lowerVerbs = coreVerbs.map(lowerFirst);
    const sessionLength = inputs.sessionLength === 'open-ended' ? 'open-ended' : `${inputs.sessionLength || '15–30 minute'} sessions`;

    const shortPitch = `${gameName} is a ${playModeLabel.toLowerCase()} ${genreLabel} game set in ${lowerFirst(setting)}. The player is ${lowerFirst(playerFantasy)} who must ${lowerFirst(primaryGoal)} while ${lowerFirst(mainPressure)}. Its defining twist is that ${lowerFirst(signatureTwist)}.`;
    const coreFantasy = `Make the player feel like ${lowerFirst(playerFantasy)} whose choices can overcome ${lowerFirst(mainPressure)}.`;

    const pillars = [
        {
            title: 'Live the fantasy',
            description: `Every major system should reinforce the feeling of being ${lowerFirst(playerFantasy)}.`,
        },
        {
            title: 'Make pressure create decisions',
            description: `Use ${lowerFirst(mainPressure)} to force prioritization and adaptation rather than passive waiting.`,
        },
        {
            title: 'Protect the defining twist',
            description: `The rule that ${lowerFirst(signatureTwist)} should affect positioning, timing, resources, or risk throughout play.`,
        },
    ];

    const mechanics = [
        {
            title: 'Primary interaction system',
            description: `The player repeatedly ${listWithAnd(lowerVerbs)} to make progress toward ${lowerFirst(primaryGoal)}. ${profiles.slice(0, 3).map((genreProfile) => genreProfile.interaction).join(' ')}`,
        },
        {
            title: 'Signature mechanic',
            description: `Turn the idea that ${lowerFirst(signatureTwist)} into a rule the player feels every few moments. It must change a decision, not exist only as story or presentation.`,
        },
        {
            title: 'Pressure and escalation',
            description: `Represent ${lowerFirst(mainPressure)} with visible states, thresholds, or behavior changes. ${profiles.slice(0, 3).map((genreProfile) => genreProfile.escalation).join(' ')}`,
        },
        {
            title: 'Trade-off system',
            description: `Each loop should ask whether to ${lowerVerbs[0]}, ${lowerVerbs[1]}, or preserve resources and position for what comes next. No option should be correct in every situation.`,
        },
        {
            title: 'Progression and rewards',
            description: `${upperFirst(progression)}. Rewards should create new ways to use the core verbs instead of bypassing the central pressure or signature mechanic.`,
        },
        {
            title: 'Feedback and readability',
            description: profiles.slice(0, 3).map((genreProfile) => genreProfile.feedback).join(' '),
        },
    ];

    const coreLoop = [
        {
            title: 'Read the situation',
            description: `Assess the immediate opportunity, the path toward ${lowerFirst(primaryGoal)}, and the current danger created by ${lowerFirst(mainPressure)}.`,
        },
        {
            title: coreVerbs[0],
            description: `Use the first core action to create position, information, resources, or momentum.`,
        },
        {
            title: coreVerbs[1],
            description: `Commit to an action that advances the objective and exposes the player to a meaningful cost or response.`,
        },
        {
            title: 'Make the defining trade-off',
            description: `Respond to the rule that ${lowerFirst(signatureTwist)} by choosing what to prioritize, risk, delay, spend, or abandon.`,
        },
        {
            title: coreVerbs[2],
            description: `Adapt to the result, protect the current plan, or recover from the consequence of the previous decision.`,
        },
        {
            title: coreVerbs[3],
            description: `Convert the player’s preparation and execution into measurable progress toward ${lowerFirst(primaryGoal)}.`,
        },
        {
            title: 'Reward, escalate, repeat',
            description: `${upperFirst(progression)}, then increase or transform the pressure so the next cycle asks a harder version of the same core question.`,
        },
    ];

    const sessionLoop = [
        `Prepare a goal, loadout, plan, or starting state appropriate to ${sessionLength}.`,
        `Enter a challenge that quickly establishes ${lowerFirst(mainPressure)}.`,
        `Repeat the ${coreVerbs.join(' → ')} loop while the signature mechanic changes the available choices.`,
        `Reach a climax where the player must commit what they learned or built during the session.`,
        `Resolve ${lowerFirst(primaryGoal)}, grant ${lowerFirst(progression)}, and create a reason to begin the next session with a different plan.`,
    ];

    const coreTest = `Is it fun to ${lowerVerbs[0]} and ${lowerVerbs[1]} while ${lowerFirst(mainPressure)}, especially when ${lowerFirst(signatureTwist)}?`;

    return {
        gameName,
        descriptor: shortPitch,
        shortPitch,
        coreFantasy,
        coreVerbs,
        pillars,
        mechanics,
        coreLoop,
        sessionLoop,
        coreTest,
        scopeRules: [
            'Add a mechanic only when it strengthens at least one core verb or makes the signature trade-off more interesting.',
            'Do not let progression remove the pressure that gives the game its identity.',
            'Validate the smallest playable version of the loop before expanding content, metaprogression, or visual scope.',
        ],
        documentationInstruction: 'Save or update this blueprint in the game repository as docs/game-design/mechanics-and-core-loop.md, preserving any approved decisions already documented.',
        ai_used: false,
    };
}

export function formatGameDesignBlueprintAsMarkdown(blueprint) {
    const sectionList = (items) => items.map((item) => `- **${item.title}:** ${item.description}`).join('\n');
    const numberedList = (items) => items.map((item, index) => `${index + 1}. **${item.title}:** ${item.description}`).join('\n');

    return `# ${blueprint.gameName} — Mechanics and Core Loop Blueprint

## Game descriptor

${withPeriod(blueprint.descriptor)}

## Core fantasy

${withPeriod(blueprint.coreFantasy)}

## Core verbs

${blueprint.coreVerbs.join(' → ')}

## Design pillars

${sectionList(blueprint.pillars)}

## Mechanics

${sectionList(blueprint.mechanics)}

## Moment-to-moment core loop

${numberedList(blueprint.coreLoop)}

## Session loop

${blueprint.sessionLoop.map((item, index) => `${index + 1}. ${item}`).join('\n')}

## Core playtest question

> ${blueprint.coreTest}

## Scope rules

${blueprint.scopeRules.map((item) => `- ${item}`).join('\n')}

## Documentation update

${blueprint.documentationInstruction || 'Save or update this blueprint in the game repository documentation.'}`;
}
