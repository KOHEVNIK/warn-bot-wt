const { Client, GatewayIntentBits, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, SlashCommandBuilder } = require('discord.js');
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
    logChannelId: process.env.LOG_CHANNEL_ID,
    appealCategoryId: process.env.APPEAL_CATEGORY_ID
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
  
  // Анимация статуса "winter team" ↔ "№1"
  const statuses = ['winter team', '№1'];
  let statusIndex = 0;
  
  setInterval(() => {
    client.user.setActivity(statuses[statusIndex], { type: 3 });
    statusIndex = (statusIndex + 1) % statuses.length;
  }, 5000);
  
  const cfg = getConfig();
  const guild = client.guilds.cache.get(cfg.guildId);
  
  if (guild) {
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
      {
        name: 'warn',
        description: 'Выдать предупреждение пользователю',
        options: [
          { name: 'user', description: 'Пользователь', type: 6, required: true },
          { name: 'days', description: 'Срок в днях', type: 4, required: true },
          { name: 'reason', description: 'Причина', type: 3, required: true },
          { name: 'workoff', description: 'Отработка (необязательно)', type: 3, required: false }
        ]
      },
      {
        name: 'unwarn',
        description: 'Снять все предупреждения с пользователя',
        options: [
          { name: 'user', description: 'Пользователь', type: 6, required: true }
        ]
      },
      { name: 'warnpanel', description: 'Создать панель управления варнами' }
    ]);
    console.log('✅ Команды зарегистрированы!');
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
  }
});

client.on('interactionCreate', async interaction => {
  const cfg = getConfig();
  const hasStaff = interaction.member?.roles?.cache?.has(cfg.staffRoleId) || 
                   interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
  
  // ========== КОМАНДА /warnpanel (панель управления) ==========
  if (interaction.isCommand() && interaction.commandName === 'warnpanel') {
    if (!hasStaff) {
      return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
    }
    
    const embed = new EmbedBuilder()
      .setTitle('⚠️ ПАНЕЛЬ УПРАВЛЕНИЯ ВАРНАМИ')
      .setDescription('**Выберите действие:**')
      .setColor(0xFFA500);
    
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_warn').setLabel('Выдать варн').setEmoji('⚠️').setStyle(ButtonStyle.Danger)
    );
    
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_unwarn').setLabel('Снять варны').setEmoji('✅').setStyle(ButtonStyle.Success)
    );
    
    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_appeal').setLabel('Обжалование').setEmoji('📝').setStyle(ButtonStyle.Primary)
    );
    
    const row4 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel_workoff').setLabel('Отработка').setEmoji('✅').setStyle(ButtonStyle.Success)
    );
    
    await interaction.channel.send({ embeds: [embed], components: [row1, row2, row3, row4] });
    await interaction.reply({ content: '✅ Панель создана!', ephemeral: true });
  }
  
  // ========== КНОПКИ ПАНЕЛИ ==========
  if (interaction.isButton()) {
    const id = interaction.customId;
    
    // Выдать варн (только стафф)
    if (id === 'panel_warn') {
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const modal = new ModalBuilder().setCustomId('warn_modal').setTitle('⚠️ Выдать предупреждение');
      
      const userInput = new TextInputBuilder().setCustomId('user').setLabel('ID пользователя или @упоминание').setPlaceholder('Например: 1492902233354797329').setStyle(TextInputStyle.Short).setRequired(true);
      const daysInput = new TextInputBuilder().setCustomId('days').setLabel('Срок в днях (любое число)').setPlaceholder('7').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4);
      const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Причина').setPlaceholder('Нарушение правил...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
      const workoffInput = new TextInputBuilder().setCustomId('workoff').setLabel('Отработка (необязательно)').setPlaceholder('Например: Принести 1000 серы').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200);
      
      modal.addComponents(
        new ActionRowBuilder().addComponents(userInput),
        new ActionRowBuilder().addComponents(daysInput),
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(workoffInput)
      );
      
      await interaction.showModal(modal);
    }
    
    // Снять варны (только стафф) - открывает окно для ввода ID
    if (id === 'panel_unwarn') {
      if (!hasStaff) return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      
      const modal = new ModalBuilder().setCustomId('unwarn_modal').setTitle('✅ Снять предупреждения');
      const userInput = new TextInputBuilder().setCustomId('user').setLabel('ID пользователя или @упоминание').setPlaceholder('Например: 1492902233354797329').setStyle(TextInputStyle.Short).setRequired(true);
      
      modal.addComponents(new ActionRowBuilder().addComponents(userInput));
      await interaction.showModal(modal);
    }
    
    // Обжалование (для всех) - автоматически определяет пользователя
    if (id === 'panel_appeal') {
      const warnRoles = interaction.member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
      
      if (warnRoles.size === 0) {
        return interaction.reply({ content: '❌ У вас нет активных предупреждений!', ephemeral: true });
      }
      
      const modal = new ModalBuilder().setCustomId('appeal_modal').setTitle('📝 Обжалование варна');
      const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Почему варн несправедлив?').setPlaceholder('Опишите вашу ситуацию...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
      
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
    
    // Отработка (для всех) - автоматически определяет пользователя
    if (id === 'panel_workoff') {
      const warnRoles = interaction.member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
      
      if (warnRoles.size === 0) {
        return interaction.reply({ content: '❌ У вас нет активных предупреждений!', ephemeral: true });
      }
      
      const modal = new ModalBuilder().setCustomId('workoff_modal').setTitle('✅ Отработка варна');
      const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Что вы сделали для отработки?').setPlaceholder('Опишите, что выполнено...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500);
      
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
    }
    
    // Закрыть тикет (для стаффа)
    if (id.startsWith('close_ticket_')) {
      const channelId = id.replace('close_ticket_', '');
      
      if (!hasStaff) {
        return interaction.reply({ content: '❌ Нет прав!', ephemeral: true });
      }
      
      await interaction.reply({ content: '🔒 Закрываю...', ephemeral: true });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
    }
  }
  
  // ========== ОБРАБОТКА МОДАЛЬНЫХ ОКОН ==========
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    
    // Снятие варнов (через кнопку)
    if (id === 'unwarn_modal') {
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
        
        const embed = new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Снято варнов:** ${removedCount}`);
        
        await interaction.editReply({ embeds: [embed] });
        
        const logEmbed = new EmbedBuilder().setTitle('✅ Варны сняты').setColor(0x00FF00).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📊 Количество', value: `${removedCount}`, inline: true }
        );
        
        await sendLog(interaction.guild, logEmbed);
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Модератор:** ${interaction.user.tag}\n**Снято варнов:** ${removedCount}`)] });
        } catch (error) {}
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
    
    // Выдача варна
    if (id === 'warn_modal') {
      const userInput = interaction.fields.getTextInputValue('user');
      const daysInput = interaction.fields.getTextInputValue('days');
      const reason = interaction.fields.getTextInputValue('reason');
      const workoff = interaction.fields.getTextInputValue('workoff') || null;
      
      await interaction.deferReply({ ephemeral: true });
      
      const durationDays = parseInt(daysInput);
      if (isNaN(durationDays) || durationDays <= 0) {
        return interaction.editReply('❌ Срок должен быть положительным числом!');
      }
      
      try {
        let userId = userInput;
        const mentionMatch = userInput.match(/<@!?(\d+)>/);
        if (mentionMatch) userId = mentionMatch[1];
        
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) return interaction.editReply('❌ Пользователь не найден!');
        
        const today = new Date();
        const dateStr = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth()+1).toString().padStart(2, '0')}.${today.getFullYear()}`;
        
        let roleName = `⚠️ Warn (${dateStr}) [${durationDays}д]`;
        if (reason) roleName += ` | 📝 ${reason}`;
        if (workoff) roleName += ` | 🔄 ${workoff}`;
        
        let warnRole = interaction.guild.roles.cache.find(r => r.name === roleName);
        if (!warnRole) {
          warnRole = await interaction.guild.roles.create({ name: roleName, color: 0xFFA500, reason: `Варн для ${member.user.tag}` });
        }
        
        await member.roles.add(warnRole);
        
        let description = `**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Причина:** ${reason}\n**Срок:** ${durationDays} дней\n**Дата выдачи:** ${dateStr}`;
        if (workoff) description += `\n**Отработка:** ${workoff}`;
        
        const embed = new EmbedBuilder().setTitle('⚠️ Предупреждение выдано').setColor(0xFFA500).setDescription(description);
        await interaction.editReply({ embeds: [embed] });
        
        const logEmbed = new EmbedBuilder().setTitle('⚠️ Выдан варн').setColor(0xFFA500).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '⏰ Срок', value: `${durationDays} дней`, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        );
        
        if (workoff) logEmbed.addFields({ name: '🔄 Отработка', value: workoff, inline: false });
        
        await sendLog(interaction.guild, logEmbed);
        
        let dmDescription = `**Причина:** ${reason}\n**Модератор:** ${interaction.user.tag}\n**Срок:** ${durationDays} дней`;
        if (workoff) dmDescription += `\n\n**Отработка:** ${workoff}`;
        dmDescription += `\n\nРоль будет автоматически снята через ${durationDays} дней.`;
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('⚠️ Вы получили предупреждение').setColor(0xFFA500).setDescription(dmDescription)] });
        } catch (error) {}
        
      } catch (error) {
        console.error('❌ Ошибка выдачи варна:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
    
    // Обжалование
    if (id === 'appeal_modal') {
      const reason = interaction.fields.getTextInputValue('reason');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const user = interaction.user;
        const member = interaction.member;
        const warnRoles = member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
        
        const warnsList = warnRoles.map(role => {
          const roleName = role.name;
          const reasonMatch = roleName.match(/📝(.+?)(?:\||$)/);
          const workoffMatch = roleName.match(/🔄(.+?)(?:\||$)/);
          
          let displayName = roleName;
          if (reasonMatch) displayName += `\n   └ 📝 **Причина:** ${reasonMatch[1].trim()}`;
          if (workoffMatch) displayName += `\n   └ 🔄 **Отработка:** ${workoffMatch[1].trim()}`;
          return `- ${displayName}`;
        }).join('\n\n');
        
        const channelOptions = {
          name: `📝-обжалование-${user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        };
        
        if (cfg.appealCategoryId) {
          const category = await interaction.guild.channels.fetch(cfg.appealCategoryId).catch(() => null);
          if (category) channelOptions.parent = cfg.appealCategoryId;
        }
        
        if (cfg.staffRoleId) {
          channelOptions.permissionOverwrites.push({ id: cfg.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        }
        
        const appealChannel = await interaction.guild.channels.create(channelOptions);
        
        const embed = new EmbedBuilder()
          .setTitle('📝 ОБЖАЛОВАНИЕ ВАРНА')
          .setColor(0xFFA500)
          .setDescription(`**Пользователь:** <@${user.id}>\n\n**Активные варны:**\n${warnsList}\n\n**Причина обжалования:**\n> ${reason}`);
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`close_ticket_${appealChannel.id}`).setLabel('Закрыть').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
        );
        
        let content = '';
        if (cfg.staffRoleId) content = `<@&${cfg.staffRoleId}>`;
        
        await appealChannel.send({ content, embeds: [embed], components: [row] });
        
        await interaction.editReply({ content: `✅ Обращение создано! Ожидайте в канале ${appealChannel}`, ephemeral: true });
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply({ content: '❌ Произошла ошибка!', ephemeral: true });
      }
    }
    
    // Отработка
    if (id === 'workoff_modal') {
      const reason = interaction.fields.getTextInputValue('reason');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const user = interaction.user;
        const member = interaction.member;
        const warnRoles = member.roles.cache.filter(r => r.name.startsWith('⚠️ Warn ('));
        
        const warnsList = warnRoles.map(role => {
          const roleName = role.name;
          const reasonMatch = roleName.match(/📝(.+?)(?:\||$)/);
          const workoffMatch = roleName.match(/🔄(.+?)(?:\||$)/);
          
          let displayName = roleName;
          if (reasonMatch) displayName += `\n   └ 📝 **Причина:** ${reasonMatch[1].trim()}`;
          if (workoffMatch) displayName += `\n   └ 🔄 **Отработка:** ${workoffMatch[1].trim()}`;
          return `- ${displayName}`;
        }).join('\n\n');
        
        const channelOptions = {
          name: `✅-отработка-${user.username}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        };
        
        if (cfg.appealCategoryId) {
          const category = await interaction.guild.channels.fetch(cfg.appealCategoryId).catch(() => null);
          if (category) channelOptions.parent = cfg.appealCategoryId;
        }
        
        if (cfg.staffRoleId) {
          channelOptions.permissionOverwrites.push({ id: cfg.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
        }
        
        const appealChannel = await interaction.guild.channels.create(channelOptions);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ ОТРАБОТКА ВАРНА')
          .setColor(0x00AA00)
          .setDescription(`**Пользователь:** <@${user.id}>\n\n**Активные варны:**\n${warnsList}\n\n**Что сделано:**\n> ${reason}`);
        
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`close_ticket_${appealChannel.id}`).setLabel('Закрыть').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
        );
        
        let content = '';
        if (cfg.staffRoleId) content = `<@&${cfg.staffRoleId}>`;
        
        await appealChannel.send({ content, embeds: [embed], components: [row] });
        
        await interaction.editReply({ content: `✅ Обращение создано! Ожидайте в канале ${appealChannel}`, ephemeral: true });
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply({ content: '❌ Произошла ошибка!', ephemeral: true });
      }
    }
  }
  
  // ========== КОМАНДЫ С ПАРАМЕТРАМИ ==========
  if (interaction.isCommand()) {
    // /warn @user 7 Причина [Отработка]
    if (interaction.commandName === 'warn') {
      if (!hasStaff) return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
      
      const user = interaction.options.getUser('user');
      const days = interaction.options.getInteger('days');
      const reason = interaction.options.getString('reason');
      const workoff = interaction.options.getString('workoff') || null;
      
      if (days <= 0) return interaction.reply({ content: '❌ Срок должен быть положительным числом!', ephemeral: true });
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply('❌ Пользователь не найден!');
        
        const today = new Date();
        const dateStr = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth()+1).toString().padStart(2, '0')}.${today.getFullYear()}`;
        
        let roleName = `⚠️ Warn (${dateStr}) [${days}д]`;
        if (reason) roleName += ` | 📝 ${reason}`;
        if (workoff) roleName += ` | 🔄 ${workoff}`;
        
        let warnRole = interaction.guild.roles.cache.find(r => r.name === roleName);
        if (!warnRole) {
          warnRole = await interaction.guild.roles.create({ name: roleName, color: 0xFFA500, reason: `Варн для ${member.user.tag}` });
        }
        
        await member.roles.add(warnRole);
        
        let description = `**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Причина:** ${reason}\n**Срок:** ${days} дней\n**Дата выдачи:** ${dateStr}`;
        if (workoff) description += `\n**Отработка:** ${workoff}`;
        
        const embed = new EmbedBuilder().setTitle('⚠️ Предупреждение выдано').setColor(0xFFA500).setDescription(description);
        await interaction.editReply({ embeds: [embed] });
        
        const logEmbed = new EmbedBuilder().setTitle('⚠️ Выдан варн').setColor(0xFFA500).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '⏰ Срок', value: `${days} дней`, inline: true },
          { name: '📝 Причина', value: reason, inline: false }
        );
        
        if (workoff) logEmbed.addFields({ name: '🔄 Отработка', value: workoff, inline: false });
        
        await sendLog(interaction.guild, logEmbed);
        
        let dmDescription = `**Причина:** ${reason}\n**Модератор:** ${interaction.user.tag}\n**Срок:** ${days} дней`;
        if (workoff) dmDescription += `\n\n**Отработка:** ${workoff}`;
        dmDescription += `\n\nРоль будет автоматически снята через ${days} дней.`;
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('⚠️ Вы получили предупреждение').setColor(0xFFA500).setDescription(dmDescription)] });
        } catch (error) {}
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
    
    // /unwarn @user
    if (interaction.commandName === 'unwarn') {
      if (!hasStaff) return interaction.reply({ content: '❌ У вас нет прав!', ephemeral: true });
      
      const user = interaction.options.getUser('user');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply('❌ Пользователь не найден!');
        
        const removedCount = await removeAllWarns(member);
        
        if (removedCount === 0) {
          return interaction.editReply(`ℹ️ У ${member.user.tag} нет активных предупреждений.`);
        }
        
        const embed = new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Пользователь:** <@${member.id}>\n**Модератор:** <@${interaction.user.id}>\n**Снято варнов:** ${removedCount}`);
        
        await interaction.editReply({ embeds: [embed] });
        
        const logEmbed = new EmbedBuilder().setTitle('✅ Варны сняты').setColor(0x00FF00).addFields(
          { name: '👤 Пользователь', value: `<@${member.id}> (${member.user.tag})`, inline: true },
          { name: '👮 Модератор', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
          { name: '📊 Количество', value: `${removedCount}`, inline: true }
        );
        
        await sendLog(interaction.guild, logEmbed);
        
        try {
          await member.send({ embeds: [new EmbedBuilder().setTitle('✅ Предупреждения сняты').setColor(0x00FF00).setDescription(`**Модератор:** ${interaction.user.tag}\n**Снято варнов:** ${removedCount}`)] });
        } catch (error) {}
        
      } catch (error) {
        console.error('❌ Ошибка:', error);
        await interaction.editReply('❌ Произошла ошибка!');
      }
    }
  }
});

// ========== ЗАПУСК ==========
const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('❌ ТОКЕН НЕ НАЙДЕН!'); process.exit(1); }
client.login(token);

// ========== HTTP СЕРВЕР ==========
http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(3000);
