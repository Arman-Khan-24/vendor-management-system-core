import pg from 'pg';
export declare const pool: pg.Pool;
export declare function query<T = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>>;
export declare function getClient(): Promise<pg.PoolClient>;
