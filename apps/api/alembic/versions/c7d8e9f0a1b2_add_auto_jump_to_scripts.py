"""add_auto_jump_to_scripts

Revision ID: c7d8e9f0a1b2
Revises: e1f2a3b4c5d6
Create Date: 2026-10-22 22:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'scripts' in tables:
        columns = [c['name'] for c in inspector.get_columns('scripts')]
        if 'auto_jump' not in columns:
            op.add_column('scripts', sa.Column('auto_jump', sa.Boolean(), server_default='0', nullable=False))

def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'scripts' in tables:
        columns = [c['name'] for c in inspector.get_columns('scripts')]
        if 'auto_jump' in columns:
            with op.batch_alter_table('scripts') as batch_op:
                batch_op.drop_column('auto_jump')
