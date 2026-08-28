import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'actuo:isPublic';

/**
 * Opts a route out of the globally-registered `JwtAuthGuard`.
 *
 * The guard is global so that authentication is the default and forgetting a
 * decorator fails closed. Exempting a route is therefore an explicit, greppable
 * act: `grep -rn '@Public()' backend/src` is the complete list of unauthenticated
 * surface area.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
