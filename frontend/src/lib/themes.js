// Colour schemes. Every theme has a dark and a light token set; the engine (lib/theme.js) writes the active one
// onto <html> as CSS custom properties, and variables.less points the Less colour variables at them
// (@page-background-color -> var(--page-background-color)), so every stylesheet follows the active theme.
//
// Token roles (see also the palette notes in docs/THEMING.md):
//   brand      identity and the one primary action per screen (active nav/tab, Save, selection, focus)
//   info       links, informational notes, pagination, progress
//   positive   connected / in library / success / complete
//   caution    warnings and unsaved changes
//   danger     errors, failures, delete
//   chart-1..6 categorical series (chart-1 follows the brand; the rest never sit next to it on the colour wheel)

const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;

// Neutral surfaces and text for one mode, optionally tinted towards `hue` (saturation `sat`, 0 = pure greys).
const neutrals = (mode, hue, sat) => {
    const t = (lightness, extra = 0) => hsl(hue, Math.min(100, sat + extra), lightness);
    if (mode === 'dark') {
        return {
            'page-background-color': t(12.5),
            'nav-background-color': t(16.5),
            'nav-active-background-color': t(20),
            'toolbar-background-color': t(15),
            'grey-pill-background-color': t(35),
            'primary-text-color': 'hsl(0 0% 100%)',
            'nav-text-color': t(89),
            'nav-link-color': t(89),
            'nav-border-color': 'hsl(0 0% 100%)',
            'table-text-color': t(80),
            'subtle-text-color': 'hsl(205 6% 48%)',
            'toolbar-text-color': t(60),
            'settings-button-background-color': t(20),
            'settings-button-border-color': t(25, 4),
            'settings-button-hover-background-color': t(27),
            'settings-button-hover-border-color': t(37, 4),
            'input-background-color': t(20),
            'input-border-color': hsl(hue, Math.max(sat, 20), 88),
            'input-text-color': t(80),
            'table-row-hover-color': 'rgba(255, 255, 255, 0.08)',
            'table-border-color': t(52),
            'login-panel-header-color': t(29),
            'login-panel-body-color': t(7),
            'logs-background-color': '#000',
            'primary-box-shadow': 'rgba(0, 0, 0, 0.075)',
            'shadow-color': 'rgba(0, 0, 0, 0.5)',
            'overlay-color': 'rgba(0, 0, 0, 0.6)',
            'hover-tint': 'rgba(255, 255, 255, 0.06)',
        };
    }
    return {
        'page-background-color': t(96.5),
        'nav-background-color': t(100),
        'nav-active-background-color': t(92),
        'toolbar-background-color': t(93.5),
        'grey-pill-background-color': t(62),
        'primary-text-color': t(10),
        'nav-text-color': t(18),
        'nav-link-color': t(18),
        'nav-border-color': t(10),
        'table-text-color': t(22),
        'subtle-text-color': hsl(205, 8, 42),
        'toolbar-text-color': t(40),
        'settings-button-background-color': t(100),
        'settings-button-border-color': t(80, 4),
        'settings-button-hover-background-color': t(94),
        'settings-button-hover-border-color': t(62, 4),
        'input-background-color': t(100),
        'input-border-color': t(72, 4),
        'input-text-color': t(14),
        'table-row-hover-color': 'rgba(0, 0, 0, 0.05)',
        'table-border-color': t(72),
        'login-panel-header-color': t(86),
        'login-panel-body-color': t(98),
        'logs-background-color': '#101010',
        'primary-box-shadow': 'rgba(0, 0, 0, 0.12)',
        'shadow-color': 'rgba(0, 0, 0, 0.18)',
        'overlay-color': 'rgba(0, 0, 0, 0.45)',
        'hover-tint': 'rgba(0, 0, 0, 0.04)',
    };
};

// Roles that do not depend on the theme, only on the mode. "Fill" colours (error/warn/success) carry black or
// white text; the foreground ones (danger/caution/positive/info) are for text and icons on the page background.
const roles = (mode) =>
    mode === 'dark'
        ? {
              'error-color': '#f05050',
              'warn-color': '#ffa500',
              'success-color': '#00853d',
              'primary-color': '#5d9cec',
              'complete-color': '#7a43b6',
              'danger-color': '#f05050',
              'caution-color': '#ffa500',
              'positive-color': '#2ecc71',
              'info-color': '#5ea6cf',
              'login-button-border-color': '#5899eb',
              'alertDangerBorderColor': '#a94442',
              'alertInfoBorderColor': '#31708f',
              'alertSuccessBorderColor': '#3c763d',
              'alertWarningBorderColor': '#8a6d3b',
              'alert-danger-text': '#e5605d',
              'alert-info-text': '#5ea6cf',
              'alert-success-text': '#5cb85c',
              'alert-warning-text': '#e0a84b',
          }
        : {
              'error-color': '#e05050',
              'warn-color': '#f0a000',
              'success-color': '#2e9e5b',
              'primary-color': '#2f7fe0',
              'complete-color': '#7a43b6',
              'danger-color': '#c62828',
              'caution-color': '#a96400',
              'positive-color': '#1b8a46',
              'info-color': '#1f6fa5',
              'login-button-border-color': '#2a6fcf',
              'alertDangerBorderColor': '#d98c8a',
              'alertInfoBorderColor': '#8fbad4',
              'alertSuccessBorderColor': '#8cc58d',
              'alertWarningBorderColor': '#d8b878',
              'alert-danger-text': '#b3261e',
              'alert-info-text': '#1f6a93',
              'alert-success-text': '#2b7d32',
              'alert-warning-text': '#8a5a00',
          };

// Categorical colours for charts, as [hue, saturation, lightness] per mode; chart-1 is the brand colour.
const CATEGORICAL = {
    dark: [
        [212, 80, 63],
        [145, 58, 50],
        [38, 100, 55],
        [265, 60, 70],
        [180, 55, 50],
        [0, 0, 65],
    ],
    light: [
        [212, 75, 45],
        [145, 60, 33],
        [34, 100, 40],
        [265, 50, 50],
        [180, 65, 33],
        [0, 0, 45],
    ],
};

// Hue of a #rrggbb colour in degrees (null for greys); used to keep the other chart colours away from the brand.
const hueOf = (brand) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(brand);
    if (!m) return 0;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return null;
    const d = max - min;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
};

const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrastRatio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

const chartColours = (mode, brand) => {
    const brandHue = hueOf(brand);
    const others = CATEGORICAL[mode].filter(([h, s]) => {
        if (brandHue === null || s === 0) return true;
        const diff = Math.abs(((h - brandHue + 540) % 360) - 180);
        return diff > 28;
    });
    const list = [brand, ...others.map(([h, s, l]) => hsl(h, s, l))];
    // Pad with greys if the colour wheel filter removed too many.
    while (list.length < 6) list.push(hsl(0, 0, mode === 'dark' ? 55 + list.length * 3 : 45 - list.length));
    return Object.fromEntries(list.slice(0, 6).map((c, i) => [`chart-${i + 1}`, c]));
};

const buildMode = (mode, { brand, tint }) => ({
    ...neutrals(mode, tint.hue, tint.sat),
    ...roles(mode),
    'brand-color': brand,
    // Text on a brand-coloured fill: whichever of white and near-black contrasts more.
    'on-brand-color': contrastRatio(brand, '#ffffff') >= contrastRatio(brand, '#111111') ? '#ffffff' : '#111111',
    ...chartColours(mode, brand),
});

const define = ({ id, name, description, dark, light, tint = { hue: 0, sat: 0 } }) => ({
    id,
    name,
    description,
    tokens: {
        dark: buildMode('dark', { brand: dark, tint }),
        light: buildMode('light', { brand: light, tint }),
    },
    // The swatches on the picker card.
    preview: { dark, light },
});

export const THEMES = [
    define({
        id: 'iplayarr',
        name: 'iPlayarr',
        description: 'The original pink on neutral greys.',
        dark: '#e11f77',
        light: '#c4125f',
    }),
    define({
        id: 'ocean',
        name: 'Ocean',
        description: 'Cool blue with a hint of slate.',
        dark: '#4c9aff',
        light: '#1a6fd6',
        tint: { hue: 215, sat: 12 },
    }),
    define({
        id: 'forest',
        name: 'Forest',
        description: 'Fresh green on soft green-grey.',
        dark: '#3ecf8e',
        light: '#17935c',
        tint: { hue: 155, sat: 8 },
    }),
    define({
        id: 'sunset',
        name: 'Sunset',
        description: 'Warm orange on warm greys.',
        dark: '#ff8a3d',
        light: '#d4601a',
        tint: { hue: 25, sat: 8 },
    }),
    define({
        id: 'violet',
        name: 'Violet',
        description: 'Soft purple on cool violet-grey.',
        dark: '#a78bfa',
        light: '#7c4dde',
        tint: { hue: 262, sat: 10 },
    }),
    define({
        id: 'graphite',
        name: 'Graphite',
        description: 'Monochrome; the accent is just white or black.',
        dark: '#e5e5e5',
        light: '#2b2b2b',
    }),
];

export const DEFAULT_THEME_ID = 'iplayarr';

export const getTheme = (id) => THEMES.find((theme) => theme.id === id) ?? THEMES[0];
