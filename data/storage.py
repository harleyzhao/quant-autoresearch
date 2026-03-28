import sqlite3
import pandas as pd
from pathlib import Path


class Storage:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS daily (
                    code TEXT, date TEXT, open REAL, high REAL,
                    low REAL, close REAL, volume REAL,
                    PRIMARY KEY (code, date)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS factors (
                    code TEXT, date TEXT,
                    factor_name TEXT, factor_value REAL,
                    PRIMARY KEY (code, date, factor_name)
                )
            """)

    def save_daily(self, df: pd.DataFrame):
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
        with sqlite3.connect(self.db_path) as conn:
            df.to_sql("daily", conn, if_exists="append", index=False)

    def load_daily(self, code: str, start: str, end: str) -> pd.DataFrame:
        with sqlite3.connect(self.db_path) as conn:
            return pd.read_sql(
                "SELECT * FROM daily WHERE code=? AND date>=? AND date<?",
                conn, params=(code, start, end),
            )

    def save_factors(self, df: pd.DataFrame):
        """Save wide-format factor DataFrame (columns are factor names)."""
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
        id_cols = ["code", "date"]
        factor_cols = [c for c in df.columns if c not in id_cols]
        long = df.melt(id_vars=id_cols, value_vars=factor_cols,
                       var_name="factor_name", value_name="factor_value")
        with sqlite3.connect(self.db_path) as conn:
            long.to_sql("factors", conn, if_exists="append", index=False)

    def load_all_factors(self, start: str = None, end: str = None) -> pd.DataFrame:
        """Load all factors in wide format, optionally filtered by date range."""
        with sqlite3.connect(self.db_path) as conn:
            if start and end:
                long = pd.read_sql(
                    "SELECT * FROM factors WHERE date>=? AND date<?",
                    conn, params=(start, end),
                )
            else:
                long = pd.read_sql("SELECT * FROM factors", conn)
        if long.empty:
            return long
        return long.pivot(index=["code", "date"], columns="factor_name",
                          values="factor_value").reset_index()

    def load_all_daily(self, start: str = None, end: str = None) -> pd.DataFrame:
        """Load all daily data, optionally filtered by date range."""
        with sqlite3.connect(self.db_path) as conn:
            if start and end:
                return pd.read_sql(
                    "SELECT * FROM daily WHERE date>=? AND date<?",
                    conn, params=(start, end),
                )
            else:
                return pd.read_sql("SELECT * FROM daily", conn)

    def load_factors(self, date: str) -> pd.DataFrame:
        with sqlite3.connect(self.db_path) as conn:
            long = pd.read_sql(
                "SELECT * FROM factors WHERE date=?", conn, params=(date,),
            )
        if long.empty:
            return long
        return long.pivot(index=["code", "date"], columns="factor_name",
                          values="factor_value").reset_index()
