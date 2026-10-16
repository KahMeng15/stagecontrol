"""add_video_markers

Revision ID: 9e1b2f3a4c5d
Revises: 6060998c468f
Create Date: 2026-10-16 21:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9e1b2f3a4c5d'
down_revision: Union[str, Sequence[str], None] = '6060998c468f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'video_markers' not in tables:
        op.create_table(
            'video_markers',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('event_id', sa.String(length=36), sa.ForeignKey('events.id', ondelete='CASCADE'), nullable=False),
            sa.Column('recording_id', sa.String(length=36), sa.ForeignKey('recordings.id', ondelete='CASCADE'), nullable=True),
            sa.Column('title', sa.String(length=150), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('timestamp_seconds', sa.Float(), nullable=True),
            sa.Column('color', sa.String(length=30), nullable=False, server_default='blue'),
            sa.Column('created_by_id', sa.String(length=36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('creator_callsign', sa.String(length=100), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_video_markers_event_id', 'video_markers', ['event_id'])
        op.create_index('ix_video_markers_recording_id', 'video_markers', ['recording_id'])


def downgrade() -> None:
    op.drop_table('video_markers')
