import { describe, expect, it } from 'vitest';
import { parseRoster, RosterParseError } from './roster.parser.js';

// Mesmo formato da exportação do sistema antigo (dados fictícios).
const SQL = `INSERT INTO apping_db.usuarios (setor,unidade,setor_id,nome,cargo,email,username,\`role\`,senha_hash,ativo) VALUES
\t ('TI','PMDC',21,'Ana D''Ávila','','100001@orgao.local','100001','admin','$2y$12$abc',1),
\t ('CPA','ADMINISTRAÇÃO',68,'Bruno (Chefe), Jr.','','100002@orgao.local','100002','user','$2y$12$d;ef',1),
\t ('TI',NULL,NULL,'Caio \\'Kaká\\' Lima','','x@orgao.local','100003','user',NULL,1);
INSERT INTO apping_db.usuarios (setor,unidade,setor_id,nome,cargo,email,username,\`role\`,senha_hash,ativo) VALUES
\t ('FAZENDA','SMF',42,'Dora','','d@orgao.local','ORGAO\\\\100004','user','x',1),
\t ('FAZENDA','SMF',42,'Sem login','','e@orgao.local','','user','x',1);`;

describe('lista de lotação: leitura', () => {
  it('lê INSERTs do MySQL com aspas, vírgulas e ponto e vírgula dentro do texto', () => {
    const r = parseRoster(SQL);
    expect(r.format).toBe('sql');
    expect(
      r.rows.map((x) => [x.username, x.displayName, x.secretaria, x.setor, x.setorId]),
    ).toEqual([
      ['100001', "Ana D'Ávila", 'PMDC', 'TI', '21'],
      ['100002', 'Bruno (Chefe), Jr.', 'ADMINISTRAÇÃO', 'CPA', '68'],
      ['100003', "Caio 'Kaká' Lima", null, 'TI', null],
      ['100004', 'Dora', 'SMF', 'FAZENDA', '42'],
    ]);
    expect(r.problems).toEqual(['Linha 5: sem login; ignorada.']);
    // A senha do arquivo não sai do leitor.
    expect(JSON.stringify(r.rows)).not.toContain('$2y$');
  });

  it('lê COPY do pg_dump', () => {
    const r = parseRoster(
      'COPY public.pessoas (login, nome, secretaria, setor) FROM stdin;\n' +
        '100001\tAna\tSMF\tTesouraria\n100002\t\\N\tSMF\tContabilidade\n\\.\n',
    );
    expect(r.rows.map((x) => [x.username, x.displayName, x.setor])).toEqual([
      ['100001', 'Ana', 'Tesouraria'],
      ['100002', null, 'Contabilidade'],
    ]);
  });

  it('lê CSV com ponto e vírgula e campos entre aspas', () => {
    const r = parseRoster(
      '﻿Matrícula;Nome Completo;Secretaria;Setor\r\n100001;"Silva; Ana";SMF;"Tesouraria ""Central"""\r\n',
    );
    expect(r.format).toBe('csv');
    expect(r.rows[0]).toMatchObject({
      username: '100001',
      displayName: 'Silva; Ana',
      secretaria: 'SMF',
      setor: 'Tesouraria "Central"',
    });
  });

  it('explica o que falta quando não acha as colunas', () => {
    expect(() => parseRoster('nome;cargo\nAna;Analista\n')).toThrow(RosterParseError);
    expect(() => parseRoster('INSERT INTO t VALUES (1,2);')).toThrow(/nomes das colunas/);
  });
});
