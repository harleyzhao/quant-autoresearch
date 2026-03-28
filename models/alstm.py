import torch
import torch.nn as nn


class Attention(nn.Module):
    def __init__(self, hidden_size: int):
        super().__init__()
        self.attn = nn.Linear(hidden_size, 1)

    def forward(self, lstm_output: torch.Tensor) -> torch.Tensor:
        # lstm_output: (batch, seq, hidden)
        scores = self.attn(lstm_output).squeeze(-1)  # (batch, seq)
        weights = torch.softmax(scores, dim=1).unsqueeze(-1)  # (batch, seq, 1)
        context = (lstm_output * weights).sum(dim=1)  # (batch, hidden)
        return context


class ALSTM(nn.Module):
    def __init__(self, input_size: int, hidden_size: int = 128,
                 num_layers: int = 2, num_classes: int = 3,
                 dropout: float = 0.3):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers,
                            batch_first=True, dropout=dropout if num_layers > 1 else 0)
        self.attention = Attention(hidden_size)
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden_size, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq, input_size)
        lstm_out, _ = self.lstm(x)       # (batch, seq, hidden)
        context = self.attention(lstm_out)  # (batch, hidden)
        out = self.dropout(context)
        return self.fc(out)                # (batch, num_classes)
