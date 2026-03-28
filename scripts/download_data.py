"""一键下载历史数据到 SQLite"""
import sys
sys.path.insert(0, ".")

from data.fetcher import Fetcher
from data.storage import Storage
from data.universe import Universe


def main():
    storage = Storage("data/cache/market.db")
    universe = Universe("csi500")
    fetcher = Fetcher()

    codes = universe.get_components()
    print(f"下载 {len(codes)} 只股票数据...")

    for i, code in enumerate(codes):
        try:
            df = fetcher.fetch_daily(code, "20180101", "20241231")
            storage.save_daily(df)
            if (i + 1) % 50 == 0:
                print(f"  进度: {i+1}/{len(codes)}")
        except Exception as e:
            print(f"  跳过 {code}: {e}")

    print("完成")


if __name__ == "__main__":
    main()
