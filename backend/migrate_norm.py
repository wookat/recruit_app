import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import create_engine, text, inspect
from database import DATABASE_URL
from normalizer import normalize_edu, parse_location_tags

def run():
    engine = create_engine(DATABASE_URL)
    with engine.connect() as conn:
        conn.execute(text("""
            ALTER TABLE positions ADD COLUMN IF NOT EXISTS edu_level_norm VARCHAR(30);
            ALTER TABLE positions ADD COLUMN IF NOT EXISTS location_tags VARCHAR(100)[];
            ALTER TABLE sources ADD COLUMN IF NOT EXISTS edu_level_norm VARCHAR(30);
            ALTER TABLE sources ADD COLUMN IF NOT EXISTS location_tags VARCHAR(100)[];
            CREATE INDEX IF NOT EXISTS idx_pos_edu_norm ON positions(edu_level_norm);
            CREATE INDEX IF NOT EXISTS idx_pos_loc_tags ON positions USING gin (location_tags);
            CREATE INDEX IF NOT EXISTS idx_src_edu_norm ON sources(edu_level_norm);
            CREATE INDEX IF NOT EXISTS idx_src_loc_tags ON sources USING gin (location_tags);
        """))
        conn.commit()

    from sqlalchemy.orm import sessionmaker
    from models import Position, Source
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        # positions
        total_pos = db.query(Position).count()
        print(f"Updating {total_pos} positions...")
        batch_size = 2000
        updated = 0
        while True:
            rows = db.query(Position).filter(
                Position.id > 0
            ).order_by(Position.id).offset(updated).limit(batch_size).all()
            if not rows:
                break
            for row in rows:
                row.edu_level_norm = normalize_edu(row.edu_requirement)
                row.location_tags = parse_location_tags(row.work_location)
            db.commit()
            updated += len(rows)
            print(f"  ... {updated} positions updated")

        # sources
        total_src = db.query(Source).count()
        print(f"Updating {total_src} sources...")
        updated = 0
        while True:
            rows = db.query(Source).filter(
                Source.id > 0
            ).order_by(Source.id).offset(updated).limit(batch_size).all()
            if not rows:
                break
            for row in rows:
                row.edu_level_norm = normalize_edu(row.edu_requirement)
                row.location_tags = parse_location_tags(row.work_location)
            db.commit()
            updated += len(rows)
            print(f"  ... {updated} sources updated")
    finally:
        db.close()
    print("Migration done.")


if __name__ == "__main__":
    run()
