const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ========== ОЧИСТКА ПРОСРОЧЕННЫХ ВАРНОВ ==========
async function cleanExpiredWarns(guild) {
  const now = new Date();
  const warnRoles = guild.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));

  for (const role of warnRoles.values()) {
    // Для ролей с датой и сроком: "⚠️ Warn (15.04.2026) [7д]"
    const nameMatch = role.name.match(/⚠️ Warn \((\d{2}\.\d{2}\.\d{4})\) \[(\d+)д\]/);
    if (!nameMatch) continue;
    
    const dateStr = nameMatch[1];
    const durationDays = parseInt(nameMatch[2]);
    
    const [day, month, year] = dateStr.split('.');
    const issueDate = new Date(`${year}-${month}-${day}`);
    const expireDate = new Date(issueDate);
    expireDate.setDate(expireDate.getDate() + durationDays);
    
    if (now >= expireDate) {
      console.log(`🗑️ Удаляем просроченный варн: ${role.name}`);
      
      for (const member of role.members.values()) {
        await member.roles.remove(role).catch(() => {});
      }
      
      if (role.members.size === 0) {
        await role.delete().catch(() => {});
      }
    }
  }
}

// ========== СНЯТИЕ ВСЕХ ВАРНОВ С ПОЛЬЗОВАТЕЛЯ ==========
async function removeAllWarns(member) {
  const warnRoles = member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
  
  for (const role of warnRoles.values()) {
    await member.roles.remove(role).catch(() => {});
    
    if (role.members.size === 0) {
      await role.delete().catch(() => {});
    }
  }
  
  return warnRoles.size;
}

// ========== ПОЛУЧЕНИЕ НАСТРОЕК ==========
const getConfig = () => {
  return {
    token: process.env.DISCORD_TOKEN,
    guildId: process.env.GUILD_ID,
    staffRoleId: process.env.STAFF_ROLE_ID,
    logChannelId: process.env.LOG_CHANNEL_ID
  };
};

// ========== ОТПРАВКА ЛОГА ==========
async function sendLog(guild, embed) {
  try {
    const cfg = getConfig();
    if (!cfg.logChannelId) return;
    
    const channel = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!channel) return;
    
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('❌ Ошибка отправки лога:', error);
  }
}

client.once('ready', async () => {
  console.log(`✅ Бот ${client.user.tag} запущен!`);
  
  // Статус бота
  client.user.setActivity('варны', { type: 3 });
  
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  
  if (guild) {
    // Очистка варнов при запуске
    await cleanExpiredWarns(guild);
    console.log('✅ Проверка варнов выполнена');
  }
  
  // Периодическая очистка (каждые 10 минут)
  setInterval(async () => {
    const g = client.guilds.cache.get(cfg.guildId);
    if (g) await cleanExpiredWarns(g);
  }, 10 * 60 * 1000);
  
  // Регистрация команд
  try {
    await client.application.commands.set([
      { name: 'warn', description: 'Выдать предупреждение пользователю' },
      { name: 'unwarn', description: 'Снять все предупреждения с пользователя' },
      { name: 'warns', description: 'Посмотреть активные варны пользователя' }
    ]);
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
  }
});

client.on('interactionCreate', async interaction => {
  const cfg = getConfig();
  
  // ========== КОМАНДА /warns (просмотр варнов) ==========
  if (interaction.isCommand() && interaction.commandName === 'warns') {
    const hasStaff = interaction.member.roles.cache.has(cfg.staffRoleId) || 
                     interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!hasStaff) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    
    if (!member) {
      return interaction.reply({ content: '❌ Пользователь не найден!', ephemeral: true });
    }
    
    const warnRoles = member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
    
    if (warnRoles.size === 0) {
      return interaction.reply({ content: `✅ У ${user.tag} нет активных предупреждений.`, ephemeral: true });
    }
    
    const warnsList = warnRoles.map(r => `- ${r.name}`).join('\n');
    
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ Варны пользователя ${user.tag}`)
      .setColor(0xFFA500)
      .setDescription(warnsList)
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
  
  // ========== КОМАНДА /unwarn (снятие варнов) ==========
  if (interaction.isCommand() && interaction.commandName === 'unwarn') {
    const hasStaff = interaction.member.roles.cache.has(cfg.staffRoleId) || 
                     interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!hasStaff) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const modal = new ModalBuilder()
      .setCustomId('unwarn_modal')
      .setTitle('✅ Снять предупреждения');
    
    const userInput = new TextInputBuilder()
      .setCustomId('user')
      .setLabel('ID пользователя или @упоминание')
      .setPlaceholder('Например: 1492902233354797329')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    
    modal.addComponents(new ActionRowBuilder().addComponents(userInput));
    
    await interaction.showModal(modal);
  }
  
  // ========== ОБРАБОТКА /unwarn ==========
  if (interaction.isModalSubmit() && interaction.customId === 'unwarn_modal') {
    const userInput = interaction.fields.getTextInputValue('user');
    
    await interaction.deferReply({ ephemeral: true });
    
    try {
      let userId = userInput;
      const mentionMatch = userInput.match(/<@!?(\d+)>/);
      if (mentionMatch) userId = mentionMatch[1];
      
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) return interaction.editReply('❌ Пользователь не найден!');
      
      const removedCount = await removeAllWarns(member);
      
      if (removedCount === 0) {
        return interaction.editReply(`ℹ️ У ${member.user.tag} нет активных предупреждений.`);
      }
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Предупреждения сняты')
        .setColor(0x00FF00)
        .setDescription(`**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Снято варнов:** ${removedCount}`)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
      
      // Лог
      const logEmbed = new EmbedBuilder()
        .setTitle('✅ Варны сняты')
        .setColor(0x00FF00)
        .addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📊 Количество', value: `${removedCount}`, inline: true }
        )
        .setTimestamp();
      
      await sendLog(interaction.guild, logEmbed);
      
      try {
        await member.send({
          embeds: [new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Модератор:** ${interaction.user.tag}\n**Снято варнов:** ${removedCount}`)]
        });
      } catch (error) {}
      
    } catch (error) {
      console.error('❌ Ошибка:', error);
      await interaction.editReply('❌ Произошла ошибка!');
    }
  }
  
  // ========== КОМАНДА /warn ==========
  if (interaction.isCommand() && interaction.commandName === 'warn') {
    const hasStaff = interaction.member.roles.cache.has(cfg.staffRoleId) || 
                     interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    
    if (!hasStaff) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const modal = new ModalBuilder()
      .setCustomId('warn_modal')
      .setTitle('⚠️ Выдать предупреждение');
    
    const userInput = new TextInputBuilder()
      .setCustomId('user')
      .setLabel('ID пользователя или @упоминание')
      .setPlaceholder('Например: 1492902233354797329')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    
    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Срок: 7, 14, 30 или forever')
      .setPlaceholder('7, 14, 30, forever')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(10);
    
    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина')
      .setPlaceholder('Нарушение правил...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);
    
    const workoffInput = new TextInputBuilder()
      .setCustomId('workoff')
      .setLabel('Отработка (необязательно)')
      .setPlaceholder('Например: Принести 1000 серы')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(200);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(userInput),
      new ActionRowBuilder().addComponents(durationInput),
      new ActionRowBuilder().addComponents(reasonInput),
      new ActionRowBuilder().addComponents(workoffInput)
    );
    
    await interaction.showModal(modal);
  }
  
  // ========== ОБРАБОТКА /warn ==========
  if (interaction.isModalSubmit() && interaction.customId === 'warn_modal') {
    const userInput = interaction.fields.getTextInputValue('user');
    const durationInput = interaction.fields.getTextInputValue('duration').toLowerCase();
    const reason = interaction.fields.getTextInputValue('reason');
    const workoff = interaction.fields.getTextInputValue('workoff') || null;
    
    await interaction.deferReply({ ephemeral: true });
    
    let durationDays = 0;
    let isForever = false;
    let durationText = '';
    
    if (durationInput === 'forever' || durationInput === 'навсегда') {
      isForever = true;
      durationText = 'навсегда';
    } else {
      durationDays = parseInt(durationInput);
      if (isNaN(durationDays) || ![7, 14, 30].includes(durationDays)) {
        return interaction.editReply('❌ Неверный срок! Укажите: 7, 14, 30 или forever');
      }
      durationText = `${durationDays}д`;
    }
    
    try {
      let userId = userInput;
      const mentionMatch = userInput.match(/<@!?(\d+)>/);
      if (mentionMatch) userId = mentionMatch[1];
      
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) return interaction.editReply('❌ Пользователь не найден!');
      
      const today = new Date();
      const dateStr = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth()+1).toString().padStart(2, '0')}.${today.getFullYear()}`;
      
      let roleName = isForever ? `⚠️ Warn (навсегда)` : `⚠️ Warn (${dateStr}) [${durationDays}д]`;
      if (reason) roleName += ` | 📝 ${reason}`;
      if (workoff) roleName += ` | 🔄 ${workoff}`;
      
      let warnRole = interaction.guild.roles.cache.find(r => r.name === roleName);
      if (!warnRole) {
        warnRole = await interaction.guild.roles.create({
          name: roleName,
          color: 0xFFA500,
          reason: `Варн для ${member.user.tag}`
        });
      }
      
      await member.roles.add(warnRole);
      
      let description = `**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Причина:** ${reason}\n**Срок:** ${durationText}`;
      if (!isForever) description += `\n**Дата выдачи:** ${dateStr}`;
      if (workoff) description += `\n**Отработка:** ${workoff}`;
      
      const embed = new EmbedBuilder().setTitle('⚠️ Предупреждение выдано').setColor(0xFFA500).setDescription(description).setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      
      // Лог
      const logEmbed = new EmbedBuilder()
        .setTitle('⚠️ Выдан варн')
        .setColor(0xFFA500)
        .addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '⏰ Срок', value: durationText, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        )
        .setTimestamp();
      
      if (workoff) logEmbed.addFields({ name: '🔄 Отработка', value: workoff, inline: false });
      
      await sendLog(interaction.guild, logEmbed);
      
      let dmDescription = `**Причина:** ${reason}\n**Модератор:** ${interaction.user.tag}\n**Срок:** ${durationText}`;
      if (workoff) dmDescription += `\n\n**Отработка:** ${workoff}`;
      if (!isForever) dmDescription += `\n\nРоль будет автоматически снята через ${durationDays} дней.`;
      
      try {
        await member.send({
          embeds: [new EmbedBuilder().setTitle('⚠️ Вы получили предупреждение').setColor(0xFFA500).setDescription(dmDescription)]
        });
      } catch (error) {}
      
    } catch (error) {
      console.error('❌ Ошибка выдачи варна:', error);
      await interaction.editReply('❌ Произошла ошибка!');
    }
  }
});

// ========== ЗАПУСК ==========
const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('❌ ТОКЕН НЕ НАЙДЕН!'); process.exit(1); }
client.login(token);

// ========== HTTP СЕРВЕР (ДЛЯ UPTIMEROBOT) ==========
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(3000);