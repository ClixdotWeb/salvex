// Demo shortcuts for developers: they open the sample admin/seller/bidder SCREENS (which show mock
// data) without a real sign-in. They never authenticate anyone, never call the backend and give no
// privileges. They exist only when ALL of these are true:
//   1. the development server is running (import.meta.env.DEV is false in every production build, so
//      this code and its text are removed from the built files), and
//   2. VITE_ENABLE_DEMO_PERSONAS=true was set explicitly (it is off by default).
export const DEMO_PERSONAS_ENABLED =
  import.meta.env.DEV === true && import.meta.env.VITE_ENABLE_DEMO_PERSONAS === 'true';
