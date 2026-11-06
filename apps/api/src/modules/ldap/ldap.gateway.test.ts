import { describe, expect, it } from 'vitest';
import { guidToString, normalizeDn, parentDn, rdnValue } from './ldap.gateway.js';

describe('DNs do AD', () => {
  it('trata acentos escapados e sem escapar como o mesmo DN', () => {
    const raw = 'OU=ADMINISTRAÇÃO PREDIAL,OU=PREFEITURA,DC=orgao,DC=local';
    const escaped = 'OU=ADMINISTRA\\c3\\87\\c3\\83O PREDIAL, OU=Prefeitura,dc=ORGAO,DC=local';
    expect(normalizeDn(escaped)).toBe(normalizeDn(raw));
    expect(normalizeDn(raw)).toBe('ou=administração predial,ou=prefeitura,dc=orgao,dc=local');
  });

  it('sobe para o pai sem se confundir com vírgula escapada no nome', () => {
    const dn = 'CN=Silva\\, João,OU=USUÁRIOS,OU=TI,DC=x';
    expect(parentDn(dn)).toBe('ou=usuários,ou=ti,dc=x');
    expect(parentDn(parentDn(dn))).toBe('ou=ti,dc=x');
    expect(normalizeDn(normalizeDn(dn))).toBe(normalizeDn(dn));
    expect(parentDn('DC=x')).toBe('');
    expect(rdnValue(dn)).toBe('Silva, João');
  });

  it('converte o objectGUID para o formato do Windows', () => {
    const b = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    expect(guidToString(b)).toBe('33221100-5544-7766-8899-aabbccddeeff');
  });
});
