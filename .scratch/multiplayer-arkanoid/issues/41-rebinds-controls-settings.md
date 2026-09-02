# 41 — Rebinds + Controls settings

**What to build:** Full input customization: keyboard fully rebindable including menu keys; gamepad buttons rebindable (movement fixed); touch/mouse fixed. Rebind screen per-player with tab between local players' maps; duplicate bindings rejected with highlight, checked across all local players' maps on the device; stored in localStorage per device. Menus navigable by any local input (first input takes focus). 4-on-keyboard achievable via rebinding; ~6-key rollover caveat documented in UI.

**Blocked by:** 26 — Mouse + gamepad input; 28 — Settings shell + persistence.

**Status:** ready-for-agent

- [ ] Keyboard rebind screen: every action rebindable incl. menu keys; changes apply live
- [ ] Gamepad buttons rebindable; stick/d-pad movement stays fixed
- [ ] Duplicate binding rejected with highlight; checked across all local players' maps on the device
- [ ] Rebind maps persist per device; corrupt maps fall back to defaults
- [ ] Any local input navigates menus; first input takes focus; tab switches between local players' rebind maps
- [ ] Rollover caveat visible in Controls UI
