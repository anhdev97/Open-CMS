// oidc-provider v9 is ESM-only and ships no type declarations. Only the surface used by
// src/provider is described here (see OidcProvider in provider.factory.ts); everything else is any.
declare module 'oidc-provider' {
  const Provider: any;
  export default Provider;
  export { Provider };
  export const errors: any;
  export const interactionPolicy: any;
}
