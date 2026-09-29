# Interface motion — 0.5.11

The UI/UX pass uses restrained, short motion to communicate interaction and
state changes. It adds no animation-library dependency.

- Buttons: 140ms color response, 220ms eased halo, 70ms one-pixel press feedback on action buttons. Hovering does not move their hit targets.
- Text links: no universal hover rectangle or inset outline. An underline grows in and directional arrows glide forward. Settings, refresh, close and send icons have contextual motion.
- Text focus: a white SVG stroke starts at the bottom midpoint and draws once clockwise around a rounded rectangle in 650ms, with a soft glow. It remains complete until focus leaves, then fades away over 320ms. Early exits preserve the partial stroke during fading; re-entry restarts from the bottom midpoint. ResizeObserver keeps the perimeter fitted to resizable textareas and narrow layouts. Native inputs, labels, selection and pointer interaction are preserved; SVG is decorative and ignores pointer events. Dashboard fields/search, dialog fields, shared notes, and the whole composer prompt box use this treatment.
- Dashboard status: a 280ms sliding neutral gray (#303034) selected background with white text, with the 12px gap preserved and pressed state exposed to assistive technology. Product-owned colors prevent VS Code's blue/custom list-selection accent from changing the Active/Completed design.
- Coordination slider: shared native range input in dashboard and dialogs; white progress fill, thumb halo/scale, tabular numeric feedback, continuous pointer adjustment, whole-level arrow keys, and native Home/End support. Filling follows the input directly rather than lagging behind a drag. Focusing or dragging does not highlight the enclosing box; keyboard focus stays visible on the thumb.
- Dialogs and forms: short opacity/translation entrances; dialogs also use a subtle scale and backdrop fade. Dialogs retain an inert, aria-hidden visual shell for a 160ms exit, restoring the opener's focus immediately. Form autofocus is preserved.
- Approval/handoff cards: gentle entrance on mount. Existing cards and streaming text do not replay entrance effects on state updates.
- Error notices: 280ms entrance and 160ms dismissal. Exiting notices immediately become inert and hidden from assistive technology. A new error cancels removal; messages never auto-dismiss merely because a timer elapsed while visible.
- Collapsible sections: rotating chevron and 300ms height/opacity interpolation on both expansion and collapse. Collapsed content is inert and aria-hidden. No looping decorative animation.
- Additional motion: composer tab underlines draw in, session cards use the same bottom-center clockwise outline and glow on hover or keyboard focus, and the welcome text/provider panel enter with short staggered delays.

Both `prefers-reduced-motion` and VS Code's `vscode-reduce-motion` body class
disable decorative transitions and animations; the white focus perimeter appears complete immediately. Notice/dialog cleanup reacts to changes
in either preference. See the [VS Code accessibility guidance](https://code.visualstudio.com/api/extension-guides/webview#accessibility).

These effects apply to Lattice-owned webviews. Native VS Code notifications,
menus, window chrome, and command-palette animations remain controlled by VS Code.
The previous demo video's editing effects are separate and its MP4 is unchanged.

Validation: `npm run test:motion` against a running preview checks range dragging,
keyboard controls, stable hover bounds, pressed feedback, selected tabs, notice
entrance/exit and replacement, preference changes, modal focus, and responsive
widths. `npm run test:workflow-ui` checks the existing user flows; unit tests and
TypeScript checks cover the application code.

The motion test injects blue and orange VS Code selection tokens to catch theme
regressions. `npm run test:native-dashboard` checks Active/Completed in an actual
VS Code extension host with dark, light, and high-contrast themes, including
sliding selection, label contrast, 12px spacing, and visible keyboard focus.
