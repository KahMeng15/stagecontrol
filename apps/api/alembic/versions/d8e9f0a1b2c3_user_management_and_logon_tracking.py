"""user_management_and_logon_tracking

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-10-25 17:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'system_settings' in tables:
        columns = [c['name'] for c in inspector.get_columns('system_settings')]
        if 'registration_mode' not in columns:
            op.add_column('system_settings', sa.Column('registration_mode', sa.String(length=20), server_default='open', nullable=False))

    if 'users' in tables:
        columns = [c['name'] for c in inspector.get_columns('users')]
        if 'approval_status' not in columns:
            op.add_column('users', sa.Column('approval_status', sa.String(length=20), server_default='approved', nullable=False))
        if 'last_login_at' not in columns:
            op.add_column('users', sa.Column('last_login_at', sa.DateTime(), nullable=True))
        if 'last_login_ip' not in columns:
            op.add_column('users', sa.Column('last_login_ip', sa.String(length=45), nullable=True))
        if 'last_login_device' not in columns:
            op.add_column('users', sa.Column('last_login_device', sa.String(length=100), nullable=True))
        if 'last_login_browser' not in columns:
            op.add_column('users', sa.Column('last_login_browser', sa.String(length=100), nullable=True))

        # Backfill Kah Meng full_name and synchronize username = email
        conn.execute(sa.text("UPDATE users SET full_name = 'Kah Meng' WHERE email = 'kahmeng15@gmail.com' AND (full_name IS NULL OR full_name = '')"))
        conn.execute(sa.text("UPDATE users SET username = email WHERE username != email"))

    if 'user_login_logs' not in tables:
        op.create_table(
            'user_login_logs',
            sa.Column('id', sa.String(length=36), primary_key=True),
            sa.Column('user_id', sa.String(length=36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('ip_address', sa.String(length=45), nullable=True),
            sa.Column('user_agent', sa.String(length=500), nullable=True),
            sa.Column('device', sa.String(length=100), nullable=True),
            sa.Column('browser', sa.String(length=100), nullable=True),
            sa.Column('status', sa.String(length=20), server_default='success', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False, index=True),
        )

def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'user_login_logs' in tables:
        op.drop_table('user_login_logs')

    if 'system_settings' in tables:
        with op.batch_alter_table('system_settings') as batch_op:
            batch_op.drop_column('registration_mode')

    if 'users' in tables:
        with op.batch_alter_table('users') as batch_op:
            batch_op.drop_column('last_login_browser')
            batch_op.drop_column('last_login_device')
            batch_op.drop_column('last_login_ip')
            batch_op.drop_column('last_login_at')
            batch_op.drop_column('approval_status')

