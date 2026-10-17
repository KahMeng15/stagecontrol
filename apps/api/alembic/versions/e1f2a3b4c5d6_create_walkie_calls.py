"""create_walkie_calls

Revision ID: e1f2a3b4c5d6
Revises: 5b6c7d8e9f0a
Create Date: 2026-10-17 23:55:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = '5b6c7d8e9f0a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'walkie_calls' not in tables:
        op.create_table(
            'walkie_calls',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('event_id', sa.String(length=36), nullable=False),
            sa.Column('caller_id', sa.String(length=36), nullable=True),
            sa.Column('caller_name', sa.String(length=100), nullable=False),
            sa.Column('caller_role', sa.String(length=30), server_default='crew', nullable=False),
            sa.Column('audio_path', sa.String(length=255), nullable=False),
            sa.Column('duration_seconds', sa.Float(), server_default='0.0', nullable=False),
            sa.Column('file_size_bytes', sa.Integer(), server_default='0', nullable=False),
            sa.Column('transcription', sa.Text(), nullable=True),
            sa.Column('language', sa.String(length=10), server_default='en', nullable=False),
            sa.Column('status', sa.String(length=30), server_default='completed', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['event_id'], ['events.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['caller_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index('ix_walkie_calls_event_id', 'walkie_calls', ['event_id'])
        op.create_index('ix_walkie_calls_caller_id', 'walkie_calls', ['caller_id'])

def downgrade() -> None:
    op.drop_index('ix_walkie_calls_caller_id', table_name='walkie_calls')
    op.drop_index('ix_walkie_calls_event_id', table_name='walkie_calls')
    op.drop_table('walkie_calls')
