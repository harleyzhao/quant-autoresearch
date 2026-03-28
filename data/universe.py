from data.fetcher import Fetcher


class Universe:
    def __init__(self, index: str = "csi500"):
        self.fetcher = Fetcher()
        self.index = index

    def get_components(self) -> list[str]:
        if self.index == "csi500":
            return self.fetcher.fetch_csi500_components()
        elif self.index == "csi1000":
            return self.fetcher.fetch_csi1000_components()
        else:
            raise ValueError(f"Unknown index: {self.index}")
