declare module "sql.js" {
  type Query = {
    columns: string[]
    values: unknown[][]
  }

  type DB = {
    exec(sql: string): Query[]
    close(): void
  }

  type Mod = {
    Database: new (data?: Uint8Array) => DB
  }

  export default function initSqlJs(opts?: { locateFile?: (file: string) => string }): Promise<Mod>
}
