"""创建用户反馈表 feedback（幂等，可在线执行）。"""
from database import Base, engine
from models import Feedback


def main():
    Base.metadata.create_all(bind=engine, tables=[Feedback.__table__])
    print("done: feedback 表已就绪")


if __name__ == "__main__":
    main()
