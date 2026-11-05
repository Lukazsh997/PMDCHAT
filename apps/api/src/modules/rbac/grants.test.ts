import { describe, expect, it } from 'vitest';
import { ROLES, type SystemRoleKey } from '@plataforma/contracts';
import { Grants, rolePermissions } from './permission.service.js';

/** Papel de sistema com as permissões padrão (como sai da instalação). */
const sys = (role: SystemRoleKey) =>
  rolePermissions({ key: role, permissions: [...ROLES[role].permissions] });

const unitA = '/a/';
const unitA1 = '/a/a1/';
const unitB = '/b/';

describe('Grants', () => {
  it('papel de unidade vale para a unidade e as de baixo, não para as vizinhas', () => {
    const g = new Grants([
      {
        id: '1',
        role: 'unit_admin',
        permissions: sys('unit_admin'),
        orgUnitId: 'a',
        orgUnitPath: unitA,
      },
    ]);
    expect(g.canOn('users.manage', unitA)).toBe(true);
    expect(g.canOn('users.manage', unitA1)).toBe(true);
    expect(g.canOn('users.manage', unitB)).toBe(false);
    expect(g.canOn('users.manage', null)).toBe(false);
    expect(g.scopePaths('users.manage')).toEqual([unitA]);
    expect(g.hasGlobal('users.manage')).toBe(false);
    expect(g.hasAny('org.manage')).toBe(false);
  });

  it('super administrador vale em todo lugar', () => {
    const g = new Grants([
      {
        id: '1',
        role: 'super_admin',
        permissions: sys('super_admin'),
        orgUnitId: null,
        orgUnitPath: null,
      },
    ]);
    expect(g.canOn('users.manage', null)).toBe(true);
    expect(g.scopePaths('users.manage')).toBeNull();
    expect(g.hasGlobal('roles.assign')).toBe(true);
    expect(g.requiresMfa).toBe(true);
  });

  it('comunicador não acessa o painel e não precisa de MFA', () => {
    const g = new Grants([
      {
        id: '1',
        role: 'broadcaster',
        permissions: sys('broadcaster'),
        orgUnitId: 'u',
        orgUnitPath: '/u/',
      },
    ]);
    expect(g.hasAny('admin.access')).toBe(false);
    expect(g.requiresMfa).toBe(false);
    expect(g.permissions).toEqual([
      'broadcast.send',
      'messages.mention_all',
      'conversations.create_channel',
    ]);
    expect(g.canOn('broadcast.send', '/u/x/')).toBe(true);
    expect(g.canOn('broadcast.send', '/v/')).toBe(false);
  });
});

describe('papéis editados no painel', () => {
  it('valem as permissões guardadas; o super administrador tem sempre todas', () => {
    const custom = new Grants([
      {
        id: '1',
        role: 'ouvidoria',
        permissions: rolePermissions({
          key: 'ouvidoria',
          permissions: ['audit.read', 'inexistente'],
        }),
        orgUnitId: null,
        orgUnitPath: null,
      },
    ]);
    expect(custom.permissions).toEqual(['audit.read']);
    expect(custom.requiresMfa).toBe(false);
    const sa = rolePermissions({ key: 'super_admin', permissions: [] });
    expect(sa).toContain('roles.manage');
  });
});
