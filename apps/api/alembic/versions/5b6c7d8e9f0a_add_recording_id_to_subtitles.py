"""add_recording_id_to_subtitles

Revision ID: 5b6c7d8e9f0a
Revises: 7a8b9c0d1e2f
Create Date: 2026-10-16 22:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '5b6c7d8e9f0a'
down_revision: Union[str, Sequence[str], None] = '7a8b9c0d1e2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('subtitles')]
    if 'recording_id' not in columns:
        with op.batch_alter_table('subtitles') as batch_op:
            batch_op.add_column(sa.Column('recording_id', sa.String(length=36), nullable=True))
            batch_op.create_foreign_key(
                'fk_subtitles_recording_id',
                'recordings',
                ['recording_id'],
                ['id'],
                ondelete='SET NULL'
            )
            batch_op.create_index('ix_subtitles_recording_id', ['recording_id'])

def downgrade() -> None:
    with op.batch_alter_table('subtitles') as batch_op:
        batch_op.drop_index('ix_subtitles_recording_id')
        batch_op.drop_constraint('fk_subtitles_recording_id', type_='foreignkey')
        batch_op.drop_column('recording_id')
