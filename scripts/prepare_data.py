"""下载数据后，计算全部因子并存入数据库"""
import sys
sys.path.insert(0, ".")

import pandas as pd
from data.storage import Storage
from data.universe import Universe
from factors.pipeline import FactorPipeline


def main():
    storage = Storage("data/cache/market.db")
    universe = Universe("csi500")
    pipeline = FactorPipeline()

    codes = universe.get_components()
    print(f"计算 {len(codes)} 只股票的因子...")

    for i, code in enumerate(codes):
        try:
            df = storage.load_daily(code, "2017-01-01", "2025-01-01")
            if len(df) < 60:
                continue
            factors = pipeline.compute(df)
            storage.save_factors(factors)
            if (i + 1) % 50 == 0:
                print(f"  进度: {i+1}/{len(codes)}")
        except Exception as e:
            print(f"  跳过 {code}: {e}")

    print("因子计算完成")


if __name__ == "__main__":
    main()
