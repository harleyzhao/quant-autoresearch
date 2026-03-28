import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from models.alstm import ALSTM


class MarketTimer:
    def __init__(self, input_size: int = 15, seq_len: int = 60,
                 hidden_size: int = 128, num_layers: int = 2,
                 num_classes: int = 3, dropout: float = 0.3,
                 lr: float = 1e-3, epochs: int = 50, batch_size: int = 64):
        self.input_size = input_size
        self.seq_len = seq_len
        self.num_classes = num_classes
        self.epochs = epochs
        self.batch_size = batch_size
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = ALSTM(input_size, hidden_size, num_layers,
                           num_classes, dropout).to(self.device)
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)
        self.criterion = nn.CrossEntropyLoss()

    def _make_sequences(self, features: np.ndarray, labels: np.ndarray = None):
        X = []
        for i in range(len(features) - self.seq_len):
            X.append(features[i:i + self.seq_len])
        X = np.array(X, dtype=np.float32)
        if labels is not None:
            return X, labels[:len(X)]
        return X

    def train(self, features: np.ndarray, labels: np.ndarray):
        X, y = self._make_sequences(features, labels)
        dataset = TensorDataset(torch.tensor(X), torch.tensor(y, dtype=torch.long))
        loader = DataLoader(dataset, batch_size=self.batch_size, shuffle=True)

        self.model.train()
        for epoch in range(self.epochs):
            for batch_x, batch_y in loader:
                batch_x, batch_y = batch_x.to(self.device), batch_y.to(self.device)
                self.optimizer.zero_grad()
                output = self.model(batch_x)
                loss = self.criterion(output, batch_y)
                loss.backward()
                self.optimizer.step()

    def predict(self, features: np.ndarray) -> int:
        """输入最近 seq_len 天的特征，返回预测类别"""
        if len(features) < self.seq_len:
            raise ValueError(f"Need at least {self.seq_len} days of features")
        x = features[-self.seq_len:]
        x = torch.tensor(x, dtype=torch.float32).unsqueeze(0).to(self.device)
        self.model.eval()
        with torch.no_grad():
            output = self.model(x)
            return int(output.argmax(dim=1).item())

    def predict_proba(self, features: np.ndarray) -> tuple[int, float]:
        """返回 (预测类别, 最大概率)"""
        x = features[-self.seq_len:]
        x = torch.tensor(x, dtype=torch.float32).unsqueeze(0).to(self.device)
        self.model.eval()
        with torch.no_grad():
            output = torch.softmax(self.model(x), dim=1)
            prob, cls = output.max(dim=1)
            return int(cls.item()), float(prob.item())

    @staticmethod
    def to_position(pred_class: int, confidence: float, threshold: float = 0.6) -> float:
        if pred_class == 2 and confidence >= threshold:
            return 1.0
        elif pred_class == 0 and confidence >= threshold:
            return 0.0
        else:
            return 0.5
