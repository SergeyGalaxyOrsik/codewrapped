import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Works with postgres-js in production and PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export { schema };
