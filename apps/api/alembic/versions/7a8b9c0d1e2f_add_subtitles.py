"""add_subtitles

Revision ID: 7a8b9c0d1e2f
Revises: 9e1b2f3a4c5d
Create Date: 2026-10-16 22:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '7a8b9c0d1e2f'
down_revision: Union[str, Sequence[str], None] = '9e1b2f3a4c5d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'subtitles' not in tables:
        op.create_table(
            'subtitles',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('event_id', sa.String(length=36), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
            sa.Column('stream_key', sa.String(length=64), nullable=True),
            sa.Column('text', sa.Text(), nullable=False),
            sa.Column('language', sa.String(length=10), nullable=False, server_default='ms'),
            sa.Column('start_seconds', sa.Float(), nullable=True),
            sa.Column('end_seconds', sa.Float(), nullable=True),
            sa.Column('confidence', sa.Float(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_subtitles_event_id'), 'subtitles', ['event_id'], unique=False)
        op.create_index(op.f('ix_subtitles_stream_key'), 'subtitles', ['stream_key'], unique=False)

def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'subtitles' in tables:
        op.drop_index(op.f('ix_subtitles_stream_key'), table_name='subtitles')
        op.drop_index(op.f('ix_subtitles_event_id'), table_name='subtitles')
        op.drop_table('subtitles')
