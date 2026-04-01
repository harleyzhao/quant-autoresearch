"""Download 2025-2026 stock data"""
import sys
sys.path.insert(0, ".")
import akshare as ak
import pandas as pd
import sqlite3
import time

DB = "data/cache/market.db"
conn = sqlite3.connect(DB)

codes = ak.index_stock_cons(symbol="000905")
code_list = codes.iloc[:, 0].tolist()
print(f"Downloading {len(code_list)} stocks for 2025-2026...")

success = 0
for i, code in enumerate(code_list):
    try:
        df = ak.stock_zh_a_hist(symbol=code, period="daily",
                                start_date="20250101", end_date="20260328", adjust="qfq")
        if len(df) > 0:
            cols = df.columns.tolist()
            df2 = pd.DataFrame({
                "code": [code] * len(df),
                "date": pd.to_datetime(df[cols[0]]).dt.strftime("%Y-%m-%d"),
                "open": df[cols[2]].values,
                "high": df[cols[4]].values,
                "low": df[cols[5]].values,
                "close": df[cols[3]].values,
                "volume": df[cols[6]].values,
            })
            df2.to_sql("daily", conn, if_exists="append", index=False)
            success += 1
        time.sleep(0.1)
    except Exception as e:
        pass
    if (i + 1) % 50 == 0:
        print(f"  {i+1}/{len(code_list)}, ok={success}")
        conn.commit()

conn.commit()
conn.close()
print(f"Done: {success}/{len(code_list)}")
