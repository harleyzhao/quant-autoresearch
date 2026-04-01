"""
Autoresearch 自动进化循环 — 直接调用 Claude API
用法: python autorun.py stock_selection
      python autorun.py market_timing
"""
import os
import sys
import subprocess
import time
import io
import anthropic

# 修复 Windows GBK 编码问题
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# 日志文件
LOG_FILE = None

def log(msg):
    print(msg, flush=True)
    if LOG_FILE:
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
        except Exception:
            pass

# === 配置 ===
API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 8192
PYTHON_PATH = os.path.join(os.environ.get("USERPROFILE", ""), "miniconda3", "envs", "quant", "python.exe")
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write_file(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def run_command(cmd, cwd=None, timeout=600):
    """运行命令并返回输出"""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True,
            cwd=cwd, timeout=timeout,
        )
        stdout = result.stdout.decode("utf-8", errors="replace")
        stderr = result.stderr.decode("utf-8", errors="replace")
        return stdout + stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "TIMEOUT", 1
    except Exception as e:
        return f"ERROR: {e}", 1


def git_commit(msg, files, cwd):
    for f in files:
        run_command(f'git add "{f}"', cwd=cwd)
    run_command(f'git commit -m "{msg}"', cwd=cwd)


def git_revert(file_path, cwd):
    run_command(f'git checkout -- "{file_path}"', cwd=cwd)


def extract_new_code(response_text):
    """从 Claude 回复中提取完整的 train.py 代码"""
    # 查找 ```python ... ``` 代码块
    blocks = []
    in_block = False
    current = []
    for line in response_text.split("\n"):
        if line.strip().startswith("```python"):
            in_block = True
            current = []
        elif line.strip() == "```" and in_block:
            in_block = False
            blocks.append("\n".join(current))
        elif in_block:
            current.append(line)

    if not blocks:
        return None

    # 返回最长的代码块（最可能是完整的 train.py）
    return max(blocks, key=len)


def extract_val_sharpe(output):
    """从训练输出中提取 VAL_SHARPE"""
    for line in output.split("\n"):
        if "VAL_SHARPE=" in line:
            try:
                return float(line.split("VAL_SHARPE=")[1].strip())
            except (ValueError, IndexError):
                pass
    return None


last_error = ""  # 上一轮的错误信息，用于反馈
experiment_history = []  # 实验历史摘要


def run_experiment(task_dir, program_md, round_num):
    """运行一轮实验"""
    global last_error
    train_py_path = os.path.join(task_dir, "train.py")
    best_sharpe_path = os.path.join(task_dir, "best_sharpe.txt")

    current_code = read_file(train_py_path)
    best_sharpe = float(read_file(best_sharpe_path).strip())

    # 获取最近的 git log
    git_log, _ = run_command("git log --oneline -10", cwd=task_dir)

    # 构建 prompt
    error_section = ""
    if last_error:
        error_section = f"""
## 上一轮错误（请避免重复）
```
{last_error[-800:]}
```
"""

    # 实验历史摘要（最近20条）
    history_section = ""
    if experiment_history:
        recent = experiment_history[-20:]
        history_section = "\n## 已尝试过的方向（请勿重复，选择新方向）\n"
        for h in recent:
            history_section += f"- 第{h['round']}轮: {h['desc']} → 夏普={h['sharpe']:.4f} {'✓' if h['improved'] else '✗'}\n"

    prompt = f"""
{program_md}

## 当前状态
- 第 {round_num} 轮实验
- 当前最优验证集夏普: {best_sharpe}
- 数据库中可用的因子: momentum_5, momentum_10, momentum_20, volatility_20, volume_ratio_5, rsi_14, macd_diff, boll_pos, ma_dev_20
- 注意: 只能使用上面列出的因子，如需新因子需在 train.py 中用 pandas 从日线数据现场计算
- 最近 git 记录:
{git_log}
{error_section}{history_section}
## 当前 train.py 代码
```python
{current_code}
```

## 你的任务
1. 分析当前代码，选择一个具体的改进方向
2. 简要说明你的改进思路（2-3句话）
3. 输出完整的修改后的 train.py（必须是完整代码，用 ```python ``` 包裹）

注意：
- 每次只改一个方向
- 优先解决过拟合问题
- 输出的代码必须是完整可运行的 train.py
- 严格使用上面 API 文档中的参数名，不要猜测
"""

    # 调用 Claude API
    client = anthropic.Anthropic(api_key=API_KEY)
    log(f"  调用 Claude API 分析并生成改进...")

    try:
        message = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = message.content[0].text
    except Exception as e:
        log(f"  API 调用失败: {e}")
        return False

    # 提取改进思路（打印前几行非代码内容）
    improvement_desc = ""
    for line in response_text.split("\n"):
        if line.strip() and not line.strip().startswith("```") and not line.strip().startswith("#"):
            log(f"  {line.strip()}")
            if len(line.strip()) > 10 and not improvement_desc:
                improvement_desc = line.strip()[:80]
            if improvement_desc:
                break

    # 提取新代码
    new_code = extract_new_code(response_text)
    if not new_code or len(new_code) < 100:
        log("  未能提取到有效代码，跳过本轮")
        return False

    # 备份并写入新代码
    write_file(train_py_path, new_code)

    # 执行训练
    log(f"  执行训练...")
    output, returncode = run_command(
        f'"{PYTHON_PATH}" -W ignore train.py',
        cwd=task_dir,
        timeout=600,
    )

    # 提取验证集夏普
    val_sharpe = extract_val_sharpe(output)

    if val_sharpe is None:
        log(f"  训练失败或无法提取夏普比率")
        # 保存错误信息供下一轮参考
        last_error = output[-800:] if output else "unknown error"
        experiment_history.append({"round": round_num, "desc": improvement_desc or "unknown", "sharpe": 0.0, "improved": False})
        try:
            log(f"  输出尾部: {output[-300:]}")
        except Exception:
            log(f"  (输出包含无法显示的字符)")
        git_revert("train.py", cwd=task_dir)
        log(f"  已回滚")
        return False

    log(f"  验证集夏普: {val_sharpe:.4f} (最优: {best_sharpe:.4f})")

    # 判断是否提升
    experiment_history.append({"round": round_num, "desc": improvement_desc or "unknown", "sharpe": val_sharpe, "improved": val_sharpe > best_sharpe})

    if val_sharpe > best_sharpe:
        last_error = ""  # 清除错误
        log(f"  ✓ 提升! {best_sharpe:.4f} → {val_sharpe:.4f}")
        write_file(best_sharpe_path, f"{val_sharpe:.4f}\n")
        task_name = os.path.basename(task_dir)
        git_commit(
            f"improve({task_name}): sharpe {best_sharpe:.4f} -> {val_sharpe:.4f}",
            ["train.py", "best_sharpe.txt"],
            cwd=task_dir,
        )
        return True
    else:
        log(f"  ✗ 未提升，回滚")
        git_revert("train.py", cwd=task_dir)
        return False


def main():
    if len(sys.argv) < 2:
        log("用法: python autorun.py <stock_selection|market_timing>")
        sys.exit(1)

    task = sys.argv[1]
    task_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), task)

    if not os.path.exists(task_dir):
        log(f"目录不存在: {task_dir}")
        sys.exit(1)

    program_md = read_file(os.path.join(task_dir, "program.md"))

    # 设置日志文件
    global LOG_FILE
    LOG_FILE = os.path.join(task_dir, "run.log")
    # 清空旧日志
    write_file(LOG_FILE, "")

    log(f"=== Autoresearch 循环启动: {task} ===")
    log(f"当前最优夏普: {read_file(os.path.join(task_dir, 'best_sharpe.txt')).strip()}")
    log(f"按 Ctrl+C 停止")
    log("")

    round_num = 1
    improvements = 0

    try:
        while True:
            log(f"===== 第 {round_num} 轮 =====")
            success = run_experiment(task_dir, program_md, round_num)
            if success:
                improvements += 1
            log(f"  总计: {round_num} 轮, {improvements} 次提升")
            log("")
            round_num += 1
            time.sleep(2)
    except KeyboardInterrupt:
        log(f"\n停止。共 {round_num - 1} 轮实验, {improvements} 次提升。")
        log(f"最终最优夏普: {read_file(os.path.join(task_dir, 'best_sharpe.txt')).strip()}")


if __name__ == "__main__":
    main()
