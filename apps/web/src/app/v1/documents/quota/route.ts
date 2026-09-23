import {readDocumentQuota} from '@autobureau/db';
import {authenticated} from '@/server/http/route';
export const GET=authenticated({requires:'registry.read'},({db,ctx})=>readDocumentQuota(db,ctx.householdId));
export const dynamic='force-dynamic';
